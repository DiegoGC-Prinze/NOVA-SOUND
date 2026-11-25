"""Ordenes enviadas por Gerencia, verificadas en PostgreSQL aislado."""
from datetime import date, timedelta
import json
import os

import pytest
from sqlalchemy import text

from test_almacen_integracion import pg_test, escenario
from test_gestion_integracion import datos, llamar
from app.modules.ordenes_produccion import incorporar_permiso, PANTALLA, ACCION

pytestmark = pytest.mark.skipif(os.getenv('ALMACEN_RUN_INTEGRATION') != '1', reason='Requiere PostgreSQL aislado')
RUTA = '/ordenes-produccion'


def payload(d):
    with d['engine'].connect() as cx:
        o = cx.execute(text('SELECT * FROM ordenes WHERE id_orden=:id'), {'id': int(d['orden'])}).mappings().one()
        hoy = cx.execute(text("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date")).scalar_one()
    return {k: o[k] for k in ('id_cliente', 'id_modelo', 'id_color', 'id_linea')} | {
        'cantidad': 123, 'fecha_compromiso': (hoy + timedelta(days=2)).isoformat()}


def test_gerencia_envia_orden_disponible_en_produccion(datos):
    d = datos
    with d['engine'].connect() as cx:
        cierres = cx.execute(text('SELECT count(*) FROM cierresturno')).scalar_one()
    r = llamar(d, 'POST', RUTA, 'gerente', json=payload(d))
    assert r.status_code == 201, r.text
    nueva = r.json()
    try:
        assert nueva['cantidad'] == 123
        assert nueva['fecha_compromiso'] == payload(d)['fecha_compromiso']
        operacion = llamar(d, 'GET', '/operacion', 'operador')
        assert operacion.status_code == 200, operacion.text
        assert next(o for o in operacion.json()['ordenes'] if o['id'] == nueva['id']) == nueva
        with d['engine'].connect() as cx:
            assert cx.execute(text('SELECT count(*) FROM cierresturno')).scalar_one() == cierres
            log = cx.execute(text("SELECT id_usuario FROM bitacora_general WHERE tabla_afectada='ordenes' AND accion='ENVIAR_ORDEN_PRODUCCION' AND id_registro_afectado=:id"), {'id': int(nueva['id'])}).scalar_one()
            assert log == d['cuentas']['gerente']['id']
    finally:
        with d['engine'].begin() as cx:
            cx.execute(text('DELETE FROM ordenes WHERE id_orden=:id'), {'id': int(nueva['id'])})


def test_permisos_y_datos_invalidos_no_crean_ordenes(datos):
    d = datos
    body = payload(d)
    assert d['api'].get('/api/v1/gestion'+RUTA).status_code == 401
    assert llamar(d, 'GET', RUTA, 'gerente').status_code == 200
    with d['engine'].connect() as cx:
        antes = cx.execute(text('SELECT count(*) FROM ordenes')).scalar_one()
    for rol in ('operador', 'lider'):
        assert llamar(d, 'POST', RUTA, rol, json=body).status_code == 403
    for cambio in ({'cantidad': 0}, {'cantidad': -1}, {'cantidad': 1.5}, {'cantidad': True},
                   {'id_color': 2147483647}, {'id_cliente': 2147483647}, {'id_modelo': 2147483647},
                   {'id_linea': 2147483647}, {'fecha_compromiso': '2000-01-01'}):
        r = llamar(d, 'POST', RUTA, 'gerente', json=body | cambio)
        assert r.status_code == 422, r.text
    with d['engine'].connect() as cx:
        assert cx.execute(text('SELECT count(*) FROM ordenes')).scalar_one() == antes


def test_nivel_de_consulta_no_envia_orden(datos):
    d = datos
    with d['engine'].begin() as cx:
        original = cx.execute(text("SELECT permisos FROM roles WHERE nombre='Gerencia'")).scalar_one()
        cx.execute(text("UPDATE roles SET permisos=jsonb_set(permisos, ARRAY[:p], '\"ver\"'::jsonb) WHERE nombre='Gerencia'"), {'p': PANTALLA})
    try:
        assert llamar(d, 'GET', RUTA+'/acceso', 'gerente').json() == {'nivel': 'ver', 'puedeEnviar': False}
        assert llamar(d, 'GET', RUTA, 'gerente').status_code == 200
        assert llamar(d, 'POST', RUTA, 'gerente', json=payload(d)).status_code == 403
    finally:
        with d['engine'].begin() as cx:
            cx.execute(text("UPDATE roles SET permisos=CAST(:p AS jsonb) WHERE nombre='Gerencia'"), {'p': json.dumps(original)})


def test_permiso_nuevo_no_modifica_otros_permisos(datos):
    engine = datos['engine']
    with engine.connect() as cx:
        antes = [dict(r) for r in cx.execute(text('SELECT id_rol,nombre,permisos,acciones FROM roles ORDER BY id_rol')).mappings()]
    incorporar_permiso(engine)
    incorporar_permiso(engine)
    with engine.connect() as cx:
        despues = [dict(r) for r in cx.execute(text('SELECT id_rol,nombre,permisos,acciones FROM roles ORDER BY id_rol')).mappings()]
    for original, actual in zip(antes, despues):
        if original['nombre'] == 'Gerencia' or (original['nombre'] == 'Administrador' and original['permisos'].get('gerencia/dashboard') in ('ver', 'acciona')):
            assert actual['permisos'][PANTALLA] == 'acciona'
            assert actual['acciones'].count(ACCION) == 1
            original['permisos'][PANTALLA] = 'acciona'
            if ACCION not in original['acciones']:
                original['acciones'].append(ACCION)
        assert original == actual


def test_administrador_recibe_seccion_y_puede_enviar_orden(datos):
    d = datos
    incorporar_permiso(d['engine'])
    login = d['api'].post('/api/v1/auth/login', json={
        'usuario': d['cuentas']['admin']['login'], 'contrasena': 'Test-gestion-2026'})
    assert login.status_code == 200, login.text
    sesion = login.json()
    assert sesion['usuario']['rol'] == 'Administrador'
    assert sesion['permisos'][PANTALLA] == 'acciona'
    assert ACCION in sesion['acciones']
    assert llamar(d, 'GET', RUTA, 'admin').status_code == 200
    r = llamar(d, 'POST', RUTA, 'admin', json=payload(d))
    assert r.status_code == 201, r.text
    try:
        produccion = llamar(d, 'GET', '/operacion', 'operador').json()
        assert any(o['id'] == r.json()['id'] for o in produccion['ordenes'])
    finally:
        with d['engine'].begin() as cx:
            cx.execute(text('DELETE FROM ordenes WHERE id_orden=:id'), {'id': int(r.json()['id'])})


def test_acceso_devuelve_permiso_actual_sin_otorgarlo_a_otros_roles(datos):
    d = datos
    incorporar_permiso(d['engine'])
    assert d['api'].get('/api/v1/gestion'+RUTA+'/acceso').status_code == 401
    for rol in ('gerente', 'admin'):
        assert llamar(d, 'GET', RUTA+'/acceso', rol).json() == {'nivel': 'acciona', 'puedeEnviar': True}
    for rol in ('operador', 'lider'):
        assert llamar(d, 'GET', RUTA+'/acceso', rol).json() == {'nivel': None, 'puedeEnviar': False}
