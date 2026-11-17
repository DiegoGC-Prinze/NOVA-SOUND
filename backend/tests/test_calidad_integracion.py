"""Pruebas y Calidad en PostgreSQL efímero; nunca sobre la base del usuario."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import os
import pytest
from sqlalchemy import text
from test_almacen_integracion import pg_test, escenario, sqlval
from test_gestion_integracion import datos, registrar

pytestmark = pytest.mark.skipif(os.getenv('ALMACEN_RUN_INTEGRATION') != '1',reason='Requiere PostgreSQL aislado')
COMPLETA = {k:'Aprobada' for k in ['encendido','audio','carga','bluetooth']}


@pytest.fixture
def flujo(datos):
    d = datos
    nombre = 'qa_inspector_'+uuid4().hex[:10]
    u = dict(numEmpleado=nombre,nombre=nombre,rol='Inspector de Calidad',estado='Activo',contrasena='Inspector-QA-2026')
    r = d['api'].post('/api/v1/gestion/usuarios',headers=d['headers']['admin'],json=u)
    assert r.status_code == 201,r.text
    sesion = d['api'].post('/api/v1/auth/login',json={'usuario':nombre,'contrasena':u['contrasena']})
    assert sesion.status_code == 200,sesion.text
    d['headers']['inspector'] = {'Authorization':'Bearer '+sesion.json()['token']}
    d['inspector'] = sesion.json()['usuario']['id']
    assert registrar(d).status_code == 200
    cat = d['api'].get('/api/v1/calidad/catalogos',headers=d['headers']['inspector']).json()
    c = next(c for c in cat['categorias']['items'] if any(i['codigo'].startswith(c['codigo']+'-') for i in cat['defectos']['items']))
    df = next(i for i in cat['defectos']['items'] if i['codigo'].startswith(c['codigo']+'-'))
    d['defecto'] = dict(categoria=c['nombre'],defecto=df['nombre'],causa='Causa de prueba')
    yield d
    with d['engine'].begin() as cx:
        ids = [r[0] for r in cx.execute(text('SELECT id_unidad FROM unidades WHERE id_usuario_registro=:id'),{'id':d['cuentas']['operador']['id']})]
        for uid in ids:
            cx.execute(text('DELETE FROM retrabajo WHERE id_unidad=:id'),{'id':uid})
            cx.execute(text('DELETE FROM defectos WHERE id_calidad IN (SELECT id_calidad FROM calidad WHERE id_unidad=:id)'),{'id':uid})
            cx.execute(text('DELETE FROM calidad WHERE id_unidad=:id'),{'id':uid})
            cx.execute(text('DELETE FROM pruebas WHERE id_unidad=:id'),{'id':uid})
        cx.execute(text('DELETE FROM bitacora_general WHERE id_usuario=:id'),{'id':d['inspector']})
        cx.execute(text('DELETE FROM sesiones_web WHERE id_usuario=:id'),{'id':d['inspector']})
        cx.execute(text('DELETE FROM usuarios WHERE id_usuario=:id'),{'id':d['inspector']})


def call(d,method,path,rol='inspector',**kwargs):
    return d['api'].request(method,'/api/v1/'+path,headers=d['headers'][rol],**kwargs)


def probar(d,prueba=None,obs=''):
    return call(d,'POST','pruebas/resultado','operador',json={'serie':d['serie'],'prueba':COMPLETA if prueba is None else prueba,'observaciones':obs})


def inspeccionar(d,estado='LIBERADA',defectos=None,obs=''):
    return call(d,'POST','calidad/unidades/'+d['serie']+'/inspeccion',json={'disposicion':estado,'defectos':defectos or [],'observaciones':obs})


def test_barreras_de_estado_y_liberacion_sin_prueba(flujo):
    d = flujo
    assert inspeccionar(d).status_code == 409
    assert probar(d,{'audio':'Aprobada'}).status_code == 422
    assert probar(d,{**COMPLETA,'audio':'Falla'}).status_code == 422
    assert probar(d,{**COMPLETA,'audio':'Falla'},'Distorsión al probar').status_code == 200
    assert inspeccionar(d).status_code == 409
    assert probar(d).status_code == 200
    assert probar(d).status_code == 409
    assert inspeccionar(d,'LIBERADA',[d['defecto']]).status_code == 422
    assert inspeccionar(d,'EN_RETENCION').status_code == 422
    assert inspeccionar(d).status_code == 200
    assert inspeccionar(d).status_code == 409
    with d['engine'].connect() as cx:
        assert sqlval(cx,'SELECT id_usuario FROM calidad WHERE id_unidad=(SELECT id_unidad FROM unidades WHERE numero_serie=:s) ORDER BY id_calidad DESC LIMIT 1',s=d['serie']) == d['inspector']


def test_permisos_e_identidad_real(flujo):
    d = flujo
    assert call(d,'GET','calidad/resumen','operador').status_code == 403
    assert call(d,'POST','pruebas/resultado',json={'serie':d['serie'],'prueba':COMPLETA}).status_code == 403
    assert probar(d).status_code == 200
    assert call(d,'POST','calidad/inspeccion',json={'numero_serie':d['serie'],'estado':'LIBERADA','id_usuario':d['cuentas']['admin']['id']}).status_code == 403
    assert call(d,'POST','calidad/unidades/'+d['serie']+'/inspeccion','operador',json={'disposicion':'LIBERADA'}).status_code == 403


def test_doble_prueba_concurrente(flujo):
    with ThreadPoolExecutor(max_workers=2) as pool:
        resultados = list(pool.map(lambda _:probar(flujo).status_code,range(2)))
    assert sorted(resultados) == [200,409]


def test_doble_inspeccion_concurrente(flujo):
    assert probar(flujo).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        resultados = list(pool.map(lambda _:inspeccionar(flujo).status_code,range(2)))
    assert sorted(resultados) == [200,409]


def test_retencion_retrabajo_y_reinspeccion(flujo):
    d = flujo
    assert probar(d).status_code == 200
    assert inspeccionar(d,'EN_RETENCION',[d['defecto']]).status_code == 200
    ruta = 'calidad/unidades/'+d['serie']
    assert call(d,'POST',ruta+'/retencion/resolver',json={'disposicion':'LIBERADA'}).status_code == 422
    assert call(d,'POST',ruta+'/retencion/resolver',json={'disposicion':'RETRABAJO','observaciones':'Requiere corregir defecto'}).status_code == 200
    assert call(d,'GET','calidad/retrabajos').json()['resumen']['pendientes'] >= 1
    assert call(d,'POST',ruta+'/retrabajo',json={'descripcion':'Se revisó la pieza','resultado':'No corregido'}).status_code == 200
    assert call(d,'POST',ruta+'/retrabajo',json={'descripcion':'Duplicado','resultado':'Corregido'}).status_code == 409
    assert inspeccionar(d).status_code == 409
    assert inspeccionar(d,'RETRABAJO',[d['defecto']]).status_code == 200
    assert call(d,'POST',ruta+'/retrabajo',json={'descripcion':'Se corrigió la pieza','resultado':'Corregido'}).status_code == 200
    assert inspeccionar(d).status_code == 200
    assert not any(f['serie'] == d['serie'] for f in call(d,'GET','calidad/retenciones').json()['filas'])
    assert next(f for f in call(d,'GET','calidad/retrabajos').json()['filas'] if f['serie'] == d['serie'])['estado'] == 'Finalizado'


def test_scrap_irreversible(flujo):
    d = flujo
    assert probar(d).status_code == 200
    assert inspeccionar(d,'SCRAP',[d['defecto']]).status_code == 422
    assert inspeccionar(d,'SCRAP',[d['defecto']],'Daño irreparable verificado').status_code == 200
    assert inspeccionar(d).status_code == 409
    assert probar(d).status_code == 409


def test_reportes_y_trazabilidad_sin_duplicar_unidades(flujo):
    d = flujo
    antes = call(d,'GET','calidad/reportes').json()
    tablero_antes = call(d,'GET','gestion/dashboard','admin').json()['defectos']
    assert probar(d).status_code == 200
    assert inspeccionar(d,'EN_RETENCION',[d['defecto']]).status_code == 200
    assert call(d,'POST','calidad/unidades/'+d['serie']+'/retencion/resolver',json={'disposicion':'LIBERADA','observaciones':'Retencion resuelta'}).status_code == 200
    despues = call(d,'GET','calidad/reportes').json()
    assert despues['total'] == antes['total']+1
    assert despues['totalDefectos'] == antes['totalDefectos']+1
    tablero_despues = call(d,'GET','gestion/dashboard','admin').json()['defectos']
    total = lambda filas:sum(f['cantidad'] for f in filas if f['defecto'] == d['defecto']['defecto'])
    assert total(tablero_despues) == total(tablero_antes)+1
    assert call(d,'GET','calidad/reportes?desde=2026-11-02&hasta=2026-11-01').status_code == 422
    traza = call(d,'GET','calidad/unidades/'+d['serie']).json()
    assert traza['prueba'] == COMPLETA and any(e['area'] == 'Calidad' for e in traza['historial'])
    assert any(e['area'] == 'Prueba funcional' and e['usuario'] == d['cuentas']['operador']['login'] for e in traza['historial'])
    assert call(d,'GET','calidad/trazabilidad/'+d['serie']).status_code == 200


def test_liberacion_habilita_empaque_y_empaque_bloquea_calidad(flujo):
    d = flujo
    assert probar(d).status_code == 200
    assert inspeccionar(d).status_code == 200
    caja = call(d,'POST','almacen/cajas','admin',json={'id_orden':int(d['orden'])})
    assert caja.status_code == 201,caja.text
    cid = caja.json()['id_caja']
    agregar = call(d,'POST',f'almacen/cajas/{cid}/unidades','admin',json={'numero_serie':d['serie']})
    assert agregar.status_code == 200,agregar.text
    assert inspeccionar(d).status_code == 409
    assert probar(d).status_code == 409
