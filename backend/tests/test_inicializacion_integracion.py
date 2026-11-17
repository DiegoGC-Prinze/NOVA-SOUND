"""Alta inicial en una base _test; incluye concurrencia y reinicios reales."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from uuid import uuid4
import pytest
from sqlalchemy import text
from fastapi.testclient import TestClient
from test_almacen_integracion import pg_test
from app import main
from app.modules import gestion
from app.core.inicializacion import crear_sistemas_inicial, MARCADOR, PERMISOS
from app.core.sesiones import hash_password, verificar_password

pytestmark = pytest.mark.skipif(os.getenv('ALMACEN_RUN_INTEGRATION') != '1', reason='Requiere PostgreSQL aislado')
PASSWORD = 'Inicial-QA-Sistemas-2026'


@pytest.fixture
def contexto(pg_test, monkeypatch):
    usuario = 'qa_sistemas_'+uuid4().hex[:10]
    monkeypatch.setattr(gestion, 'engine', pg_test)
    with pg_test.connect() as cx:
        assert not cx.execute(text('SELECT 1 FROM configuracion_web WHERE clave=:c'), {'c': MARCADOR}).first()
        roles_antes = set(cx.execute(text("SELECT id_rol FROM roles WHERE nombre='Sistemas'")).scalars())
    yield dict(engine=pg_test, usuario=usuario, nombre='Sistemas QA', password=PASSWORD)
    with pg_test.begin() as cx:
        cx.execute(text('DELETE FROM configuracion_web WHERE clave=:c'), {'c': MARCADOR})
        uids = list(cx.execute(text('SELECT id_usuario FROM usuarios WHERE usuario LIKE :prefijo'), {'prefijo': usuario+'%'}).scalars())
        for uid in uids:
            cx.execute(text('DELETE FROM bitacora_general WHERE id_usuario=:id OR (tabla_afectada=\'usuarios\' AND id_registro_afectado=:id)'), {'id': uid})
            cx.execute(text('DELETE FROM sesiones_web WHERE id_usuario=:id'), {'id': uid})
            cx.execute(text('DELETE FROM usuarios WHERE id_usuario=:id'), {'id': uid})
        for rid in cx.execute(text("SELECT id_rol FROM roles WHERE nombre='Sistemas'")).scalars().all():
            if rid not in roles_antes:
                cx.execute(text('DELETE FROM roles WHERE id_rol=:id'), {'id': rid})


def iniciar(c, **cambios):
    datos = dict(usuario=c['usuario'], nombre=c['nombre'], password=c['password'])
    datos.update(cambios)
    return crear_sistemas_inicial(c['engine'], **datos)


def cuenta(c):
    with c['engine'].connect() as cx:
        return dict(cx.execute(text('''SELECT u.*,r.nombre AS rol,r.permisos,r.acciones FROM usuarios u
            JOIN roles r USING(id_rol) WHERE usuario=:u'''), {'u': c['usuario']}).mappings().one())


def login(c, password=PASSWORD):
    return TestClient(main.app).post('/api/v1/auth/login', json={'usuario': c['usuario'], 'contrasena': password})


def test_crea_usuario_con_rol_sistemas_y_password_hash(contexto):
    c = contexto
    assert iniciar(c)
    u = cuenta(c)
    assert u['rol'] == 'Sistemas' and u['activo'] and u['estado'] == 'Activo'
    assert u['contrasena'].startswith('scrypt$') and verificar_password(PASSWORD, u['contrasena'])
    assert u['permisos'] == PERMISOS
    assert all(p.startswith(('login/', 'sistemas/')) for p in u['permisos'])
    assert login(c).status_code == 200


def test_reinicio_no_cambia_password_ni_duplica_cuentas(contexto):
    c = contexto
    assert iniciar(c)
    antes = cuenta(c)
    assert not iniciar(c, password='Otra-Clave-De-Arranque')
    assert cuenta(c) == antes
    assert login(c).status_code == 200
    assert login(c, 'Otra-Clave-De-Arranque').status_code == 401


def test_reinicio_respeta_bloqueo_permisos_y_cambio_de_identificador_env(contexto):
    c = contexto
    assert iniciar(c)
    with c['engine'].begin() as cx:
        cx.execute(text("UPDATE usuarios SET activo=FALSE,estado='Bloqueado' WHERE usuario=:u"), {'u': c['usuario']})
        cx.execute(text("UPDATE roles SET permisos='{}'::jsonb WHERE nombre='Sistemas'"))
    assert not iniciar(c, usuario=c['usuario']+'-otro', password='')
    assert cuenta(c)['estado'] == 'Bloqueado' and cuenta(c)['permisos'] == {}
    assert login(c).status_code == 401
    with c['engine'].connect() as cx:
        assert not cx.execute(text('SELECT 1 FROM usuarios WHERE usuario=:u'), {'u': c['usuario']+'-otro'}).first()


def test_password_invalida_revierte_el_alta_completa(contexto):
    c = contexto
    for password in ['', 'corta', '        ']:
        with pytest.raises(RuntimeError, match='SISTEMAS_PASSWORD'):
            iniciar(c, password=password)
    with c['engine'].connect() as cx:
        assert not cx.execute(text('SELECT 1 FROM configuracion_web WHERE clave=:c'), {'c': MARCADOR}).first()
        assert not cx.execute(text('SELECT 1 FROM usuarios WHERE usuario=:u'), {'u': c['usuario']}).first()


def test_no_toma_una_cuenta_existente_de_otro_rol(contexto):
    c = contexto
    with c['engine'].connect() as cx:
        antes = dict(cx.execute(text("SELECT * FROM usuarios WHERE usuario='admin'")).mappings().one())
    with pytest.raises(RuntimeError, match='otro rol'):
        iniciar(c, usuario='admin')
    with c['engine'].connect() as cx:
        assert dict(cx.execute(text("SELECT * FROM usuarios WHERE usuario='admin'")).mappings().one()) == antes


def test_arranques_simultaneos_crean_una_sola_cuenta(contexto):
    with ThreadPoolExecutor(max_workers=2) as pool:
        resultados = list(pool.map(lambda _: iniciar(contexto), range(2)))
    assert sorted(resultados) == [False, True]
    with contexto['engine'].connect() as cx:
        assert cx.execute(text('SELECT count(*) FROM usuarios WHERE usuario=:u'), {'u': contexto['usuario']}).scalar_one() == 1


def test_cuenta_sistemas_preexistente_conserva_password_y_estado(contexto):
    c = contexto
    with c['engine'].begin() as cx:
        rid = cx.execute(text('''INSERT INTO roles(nombre,permisos,acciones)
            VALUES ('Sistemas',CAST(:p AS jsonb),'[]'::jsonb) RETURNING id_rol'''), {'p': json.dumps(PERMISOS)}).scalar_one()
        cx.execute(text('''INSERT INTO usuarios(id_rol,nombre,usuario,contrasena,activo,estado)
            VALUES (:r,'Existente',:u,:p,FALSE,'Inactivo')'''), {'r': rid, 'u': c['usuario'], 'p': hash_password('Password-Anterior')})
    antes = cuenta(c)
    assert not iniciar(c)
    assert cuenta(c) == antes


def test_sistemas_inicial_puede_dar_de_alta_usuarios(contexto):
    c = contexto
    assert iniciar(c)
    sesion = login(c).json()
    api = TestClient(main.app)
    headers = {'Authorization': 'Bearer '+sesion['token']}
    assert api.get('/api/v1/gestion/roles', headers=headers).status_code == 200
    assert api.get('/api/v1/gestion/operacion', headers=headers).status_code == 403
    usuario = c['usuario']+'-operador'
    r = api.post('/api/v1/gestion/usuarios', headers=headers, json=dict(numEmpleado=usuario, nombre='Operador creado por Sistemas',
        rol='Operador', estado='Activo', contrasena='Operador-Nuevo-2026'))
    assert r.status_code == 201, r.text
    assert api.post('/api/v1/auth/login', json={'usuario': usuario, 'contrasena': 'Operador-Nuevo-2026'}).status_code == 200


def test_lifespan_real_crea_cuenta_y_respeta_reinicios(contexto, monkeypatch):
    c = contexto
    monkeypatch.setattr(main, 'engine', c['engine'])
    for key, value in [('SISTEMAS_USUARIO', c['usuario']), ('SISTEMAS_NOMBRE', c['nombre']), ('SISTEMAS_PASSWORD', PASSWORD)]:
        monkeypatch.setenv(key, value)
    with TestClient(main.app) as api:
        assert api.get('/api/v1/health').status_code == 200
        assert login(c).status_code == 200
    antes = cuenta(c)
    with TestClient(main.app):
        assert cuenta(c) == antes
