"""Flujos de Gestión en PostgreSQL separado; comparten la protección de la suite de Almacén."""
import json
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from test_almacen_integracion import pg_test, escenario, sqlval
from app.main import app
from app.modules import gestion
from app.core.sesiones import hash_password

pytestmark = pytest.mark.skipif(__import__('os').getenv('ALMACEN_RUN_INTEGRATION') != '1', reason='Requiere PostgreSQL aislado de pruebas')
API = '/api/v1/gestion'


@pytest.fixture
def datos(pg_test, escenario, monkeypatch):
    monkeypatch.setattr(gestion, 'engine', pg_test)
    sufijo = uuid4().hex[:10]
    cuentas = {}
    with pg_test.begin() as cx:
        for key, rol in [('operador', 'Operador'), ('lider', 'Líder de línea'), ('gerente', 'Gerente de Producción')]:
            login = 'qa_'+key+'_'+sufijo
            rid = sqlval(cx, 'SELECT id_rol FROM roles WHERE nombre=:r LIMIT 1', r=rol)
            uid = sqlval(cx, 'INSERT INTO usuarios(id_rol,nombre,usuario,contrasena) VALUES (:r,:n,:n,:p) RETURNING id_usuario', r=rid, n=login, p=hash_password('Test-gestion-2026'))
            cuentas[key] = dict(id=uid, login=login)
        uid = escenario['usuario']
        cx.execute(text('UPDATE usuarios SET contrasena=:p WHERE id_usuario=:id'), {'p': hash_password('Test-gestion-2026'), 'id': uid})
        cuentas['admin'] = dict(id=uid, login=sqlval(cx, 'SELECT usuario FROM usuarios WHERE id_usuario=:id', id=uid))
        o = cx.execute(text('SELECT * FROM ordenes WHERE id_orden=:id'), {'id': escenario['orden_mini']}).mappings().one()
        linea = sqlval(cx, "SELECT COALESCE((SELECT codigo FROM catalogos_web WHERE tipo='lineas' AND id_original=:id),'L'||:id)", id=o['id_linea'])
    cliente = TestClient(app)
    tokens = {}
    for key, c in cuentas.items():
        r = cliente.post('/api/v1/auth/login', json={'usuario': c['login'], 'contrasena': 'Test-gestion-2026'})
        assert r.status_code == 200, r.text
        assert r.json()['modo'] == 'real'
        tokens[key] = {'Authorization': 'Bearer '+r.json()['token']}
    yield dict(api=cliente, headers=tokens, cuentas=cuentas, orden=str(escenario['orden_mini']), linea=linea,
               lineaId=o['id_linea'], turno=1, serie='QA-PROD-'+sufijo, lote='QA-LOTE-'+sufijo, engine=pg_test,
               escenario=escenario)
    # Retirar únicamente filas de este escenario, incluso cuando un assert falla.
    uids = [c['id'] for c in cuentas.values()]
    with pg_test.begin() as cx:
        for uid in uids:
            cx.execute(text('DELETE FROM ajustes_conteo_web WHERE id_autorizacion IN (SELECT id_autorizacion FROM autorizacion WHERE id_usuario_solicita=:u OR id_usuario_autoriza=:u)'), {'u': uid})
            cx.execute(text('DELETE FROM bitacora_general WHERE id_usuario=:u'), {'u': uid})
            cx.execute(text('DELETE FROM autorizacion WHERE id_usuario_solicita=:u OR id_usuario_autoriza=:u'), {'u': uid})
            cx.execute(text('DELETE FROM cierresturno WHERE id_usuario=:u'), {'u': uid})
            cx.execute(text('DELETE FROM incidencias_web WHERE id_usuario=:u'), {'u': uid})
            cx.execute(text('DELETE FROM ensamble WHERE id_usuario=:u'), {'u': uid})
            cx.execute(text('DELETE FROM unidades WHERE id_usuario_registro=:u'), {'u': uid})
            cx.execute(text('DELETE FROM sesiones_web WHERE id_usuario=:u'), {'u': uid})
            cx.execute(text('UPDATE configuracion_web SET id_usuario=NULL WHERE id_usuario=:u'), {'u': uid})
        cx.execute(text("DELETE FROM lote WHERE codigo=:c"), {'c': 'QA-LOTE-'+sufijo})
        for key in ['operador', 'lider', 'gerente']:
            cx.execute(text('DELETE FROM usuarios WHERE id_usuario=:u'), {'u': cuentas[key]['id']})


def llamar(d, metodo, ruta, rol='admin', **kwargs):
    return d['api'].request(metodo, API+ruta, headers=d['headers'][rol], **kwargs)


def registrar(d, serie=None):
    return llamar(d, 'POST', '/operacion/registrarUnidad', 'operador', json={
        'orden': d['orden'], 'turno': d['turno'], 'lote': d['lote'], 'serie': serie or d['serie']})


def cerrar(d):
    return llamar(d, 'POST', '/operacion/cerrarTurno', 'lider', json={'linea': d['linea'], 'turno': d['turno'], 'motivo': 'Cierre QA verificado'})


def solicitar(d, tipo='Reapertura de turno', nuevo=None):
    return llamar(d, 'POST', '/operacion/solicitarAjuste', 'lider', json={'orden': d['orden'], 'turno': d['turno'], 'tipo': tipo, 'nuevo': nuevo, 'motivo': 'Motivo completo de prueba QA'})


def test_lecturas_reales_y_permisos(datos):
    d = datos
    assert d['api'].get(API+'/usuarios').status_code == 401
    assert llamar(d, 'GET', '/usuarios', 'operador').status_code == 403
    for ruta in ['/opciones', '/operacion', '/dashboard', '/discrepancias', '/cierres-turno', '/autorizaciones', '/usuarios', '/roles', '/catalogos', '/parametros', '/tickets']:
        r = llamar(d, 'GET', ruta)
        assert r.status_code == 200, (ruta, r.text)
    roles = llamar(d, 'GET', '/roles').json()
    assert {'calidad', 'prueba-funcional'}.issubset({p['area'] for p in roles['pantallas']})


def test_registro_ensamble_duplicado_y_calidad_intacta(datos):
    d = datos
    with d['engine'].connect() as cx:
        antes = [sqlval(cx, f'SELECT count(*) FROM {t}') for t in ['pruebas', 'calidad']]
    r = registrar(d)
    assert r.status_code == 200, r.text
    assert registrar(d).status_code == 409
    with d['engine'].connect() as cx:
        u = cx.execute(text('SELECT * FROM unidades WHERE numero_serie=:s'), {'s': d['serie']}).mappings().one()
        assert u['estado'] == 'ENSAMBLADA' and u['id_caja'] is None
        assert u['id_usuario_registro'] == d['cuentas']['operador']['id']
        assert sqlval(cx, 'SELECT count(*) FROM ensamble WHERE id_lote=:l', l=u['id_lote']) == 1
        assert antes == [sqlval(cx, f'SELECT count(*) FROM {t}') for t in ['pruebas', 'calidad']]
    traza = llamar(d, 'GET', '/unidades/'+d['serie'], 'gerente')
    assert traza.status_code == 200, traza.text
    assert traza.json()['historial'][0]['usuario'] == d['cuentas']['operador']['login']


def test_dos_capturas_simultaneas_no_duplican(datos):
    with ThreadPoolExecutor(max_workers=2) as pool:
        estados = list(pool.map(lambda _: registrar(datos).status_code, range(2)))
    assert sorted(estados) == [200, 409]


def test_cierre_bloquea_reapertura_y_resolucion_unica(datos):
    d = datos
    assert solicitar(d).status_code == 409
    assert registrar(d).status_code == 200
    assert cerrar(d).status_code == 200
    assert cerrar(d).status_code == 409
    assert registrar(d, d['serie']+'-B').status_code == 409
    s = solicitar(d)
    assert s.status_code == 200, s.text
    assert solicitar(d).status_code == 409
    ruta = '/autorizaciones/'+s.json()['id']+'/resolver'
    assert llamar(d, 'POST', ruta, 'operador', json={'decision': 'aprobar'}).status_code == 403
    assert llamar(d, 'POST', ruta, 'gerente', json={'decision': 'aprobar'}).status_code == 200
    assert llamar(d, 'POST', ruta, 'gerente', json={'decision': 'aprobar'}).status_code == 409
    assert registrar(d, d['serie']+'-B').status_code == 200


def test_correccion_ajusta_conteo_sin_crear_series(datos):
    d = datos
    assert registrar(d).status_code == 200
    assert cerrar(d).status_code == 200
    actual = sum(r['reportadas'] for r in llamar(d, 'GET', '/operacion', 'lider').json()['resumen'] if r['orden'] == d['orden'] and r['turno'] == d['turno'])
    s = solicitar(d, 'Corrección de cierre', actual+3)
    assert s.status_code == 200, s.text
    with d['engine'].connect() as cx:
        antes = sqlval(cx, 'SELECT count(*) FROM unidades')
    assert llamar(d, 'POST', '/autorizaciones/'+s.json()['id']+'/resolver', 'gerente', json={'decision': 'aprobar'}).status_code == 200
    with d['engine'].connect() as cx:
        assert sqlval(cx, 'SELECT count(*) FROM unidades') == antes
    nuevo = sum(r['reportadas'] for r in llamar(d, 'GET', '/operacion', 'lider').json()['resumen'] if r['orden'] == d['orden'] and r['turno'] == d['turno'])
    assert nuevo == actual+3


def test_motivo_rechazo_y_no_autoautorizacion(datos):
    d = datos
    assert cerrar(d).status_code == 200
    r = llamar(d, 'POST', '/operacion/solicitarAjuste', json={'orden': d['orden'], 'turno': 1, 'tipo': 'Reapertura de turno', 'motivo': 'Peticion desde administrador'})
    assert r.status_code == 200, r.text
    ruta = '/autorizaciones/'+r.json()['id']+'/resolver'
    assert llamar(d, 'POST', ruta, json={'decision': 'aprobar'}).status_code == 403
    assert llamar(d, 'POST', ruta, 'gerente', json={'decision': 'rechazar'}).status_code == 422
    assert llamar(d, 'POST', ruta, 'gerente', json={'decision': 'rechazar', 'motivo': 'No procede la reapertura'}).status_code == 200


def test_solicitud_anterior_no_reabre_nuevo_cierre(datos):
    d = datos
    assert cerrar(d).status_code == 200
    vieja = solicitar(d, 'Corrección de cierre', 99).json()['id']
    nueva = solicitar(d).json()['id']
    assert llamar(d, 'POST', '/autorizaciones/'+nueva+'/resolver', 'gerente', json={'decision': 'aprobar'}).status_code == 200
    assert cerrar(d).status_code == 200
    assert llamar(d, 'POST', '/autorizaciones/'+vieja+'/resolver', 'gerente', json={'decision': 'aprobar'}).status_code == 409


def test_usuario_bloqueado_revoca_token_y_no_expone_password(datos):
    d = datos
    numero = d['cuentas']['operador']['login']
    u = llamar(d, 'GET', '/usuarios/'+numero).json()
    assert 'contrasena' not in u
    u.update(estado='Bloqueado', contrasena='')
    r = llamar(d, 'PUT', '/usuarios/'+numero, json=u)
    assert r.status_code == 200, r.text
    assert llamar(d, 'GET', '/operacion', 'operador').status_code == 401
    assert d['api'].post('/api/v1/auth/login', json={'usuario': numero, 'contrasena': 'Test-gestion-2026'}).status_code == 401
    admin = llamar(d, 'GET', '/usuarios/'+d['cuentas']['admin']['login']).json()
    admin.update(estado='Inactivo')
    assert llamar(d, 'PUT', '/usuarios/'+admin['numEmpleado'], json=admin).status_code == 409


def test_permisos_cambian_en_servidor_sin_relogin(datos):
    d = datos
    rol = next(r for r in llamar(d, 'GET', '/roles').json()['roles'] if r['nombre'] == 'Operador')
    try:
        cambio = dict(permisos={k: v for k, v in rol['permisos'].items() if k != 'produccion/registrar-produccion'}, acciones=rol['acciones'])
        assert llamar(d, 'PUT', '/roles/Operador', json=cambio).status_code == 200
        assert registrar(d).status_code == 403
    finally:
        assert llamar(d, 'PUT', '/roles/Operador', json=rol).status_code == 200


def test_incidencias_y_ticket_publico_con_cierre(datos):
    d = datos
    r = llamar(d, 'POST', '/operacion/registrarIncidencia', 'operador', json={'linea': d['linea'], 'tipo': 'Equipo', 'severidad': 'Alta', 'paro': 5, 'motivo': 'Incidencia QA real'})
    assert r.status_code == 200, r.text
    r = d['api'].post(API+'/tickets', json={'numEmpleado': 'QA', 'nombre': 'QA soporte', 'motivo': 'Cuenta bloqueada'})
    assert r.status_code == 201
    tid = r.json()['id']
    try:
        assert llamar(d, 'GET', '/tickets/'+tid).json()['estado'] == 'Abierto'
        assert llamar(d, 'POST', '/tickets/'+tid+'/cerrar', json={'comentarios': 'Cuenta revisada'}).status_code == 200
        assert llamar(d, 'POST', '/tickets/'+tid+'/cerrar', json={'comentarios': 'Otra vez'}).status_code == 409
    finally:
        with d['engine'].begin() as cx:
            cx.execute(text('DELETE FROM tickets_web WHERE id_ticket=:id'), {'id': int(tid[2:])})


def test_parametros_aplican_a_nuevas_cajas(datos):
    d = datos
    p = llamar(d, 'GET', '/parametros').json()['capacidadCaja']
    try:
        cambio = {**p, 'NS-MINI': 11}
        assert llamar(d, 'PUT', '/parametros', json={'capacidadCaja': cambio, 'motivo': 'Prueba de capacidad configurada'}).status_code == 200
        r = d['api'].post('/api/v1/almacen/cajas', headers=d['headers']['admin'], json={'id_orden': int(d['orden'])})
        assert r.status_code == 201, r.text
        assert r.json()['capacidad'] == 11
        assert llamar(d, 'PUT', '/parametros', json={'capacidadCaja': {**p, 'NS-MINI': 0}, 'motivo': 'Invalido'}).status_code == 422
    finally:
        assert llamar(d, 'PUT', '/parametros', json={'capacidadCaja': p, 'motivo': 'Restaurar prueba'}).status_code == 200


def test_catalogo_inactivo_bloquea_produccion_sin_borrar_historial(datos):
    d = datos
    cliente_id = d['escenario']['cliente']
    cliente = next(i for i in llamar(d, 'GET', '/catalogos').json()['clientes']['items'] if i['id'] == cliente_id)
    ruta = '/catalogos/clientes/'+cliente['codigo']
    try:
        assert llamar(d, 'PATCH', ruta, json={'estado': 'Inactivo'}).status_code == 200
        assert registrar(d).status_code == 422
        assert llamar(d, 'PATCH', ruta, json={'estado': 'Activo'}).status_code == 200
        assert registrar(d).status_code == 200
    finally:
        with d['engine'].begin() as cx:
            cx.execute(text("DELETE FROM catalogos_web WHERE tipo='clientes' AND id_original=:id"), {'id': cliente_id})


def test_cierre_conserva_foto_y_correccion_actualiza_reportadas(datos):
    d = datos
    assert registrar(d).status_code == 200
    assert cerrar(d).status_code == 200
    reporte = llamar(d, 'GET', '/cierres-turno', 'gerente').json()
    fila = next(r for r in reporte if r['linea'] == d['linea'] and r['turno'] == d['turno'] and r['estado'] == 'Cerrado')
    original = fila['reportadas']
    # Cambia el estado vigente de la unidad: el cierre conserva su foto original.
    with d['engine'].begin() as cx:
        cx.execute(text("UPDATE unidades SET estado='EN_RETENCION' WHERE numero_serie=:s"), {'s': d['serie']})
    nuevo = next(r for r in llamar(d, 'GET', '/cierres-turno', 'gerente').json() if r['linea'] == d['linea'] and r['turno'] == d['turno'] and r['estado'] == 'Cerrado')
    assert nuevo == fila
    actual = sum(r['reportadas'] for r in llamar(d, 'GET', '/operacion', 'lider').json()['resumen'] if r['orden'] == d['orden'] and r['turno'] == d['turno'])
    s = solicitar(d, 'Corrección de cierre', actual+2)
    assert s.status_code == 200, s.text
    assert llamar(d, 'POST', '/autorizaciones/'+s.json()['id']+'/resolver', 'gerente', json={'decision': 'aprobar'}).status_code == 200
    nuevo = next(r for r in llamar(d, 'GET', '/cierres-turno', 'gerente').json() if r['linea'] == d['linea'] and r['turno'] == d['turno'] and r['estado'] == 'Cerrado')
    assert nuevo['reportadas'] == original+2
