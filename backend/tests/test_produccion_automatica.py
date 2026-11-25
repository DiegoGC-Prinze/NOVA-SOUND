"""Series unicas y lotes agrupados en PostgreSQL separado de la aplicacion."""
from concurrent.futures import ThreadPoolExecutor
import os
import re

import pytest
from sqlalchemy import text

from test_almacen_integracion import pg_test, escenario
from test_gestion_integracion import datos, llamar, cerrar

pytestmark = pytest.mark.skipif(os.getenv('ALMACEN_RUN_INTEGRATION') != '1', reason='Requiere PostgreSQL aislado')


def registrar(d, **cambios):
    return llamar(d, 'POST', '/operacion/registrarUnidad', 'operador',
                  json={'orden': d['orden'], 'turno': 1, **cambios})


def test_serie_por_pieza_y_lote_compartido_con_trazabilidad(datos):
    d = datos
    registros = [registrar(d) for _ in range(2)]
    assert all(r.status_code == 200 for r in registros), [r.text for r in registros]
    primero, segundo = [r.json() for r in registros]
    assert primero['serie'] != segundo['serie']
    assert primero['lote'] == segundo['lote']
    assert re.fullmatch(r'NS-\d{8}-\d{8,}', primero['serie'])
    with d['engine'].connect() as cx:
        filas = cx.execute(text('SELECT id_unidad,numero_serie,id_lote FROM unidades WHERE id_unidad IN (:a,:b)'),
                           {'a': primero['id'], 'b': segundo['id']}).mappings().all()
        assert len(filas) == 2 and filas[0]['id_lote'] == filas[1]['id_lote']
        for f in filas:
            assert f['numero_serie'].endswith(f"{f['id_unidad']:08d}")
    traza = llamar(d, 'GET', '/unidades/'+primero['serie'], 'gerente')
    assert traza.status_code == 200, traza.text
    assert traza.json()['estado'] == 'ENSAMBLADA'
    assert traza.json()['lote'] == primero['lote']


def test_lote_cambia_por_turno_y_por_orden(datos):
    a = registrar(datos)
    b = registrar(datos, turno=2)
    c = registrar(datos, orden=str(datos['escenario']['orden_pro']))
    assert all(r.status_code == 200 for r in (a,b,c)), [r.text for r in (a,b,c)]
    assert len({r.json()['lote'] for r in (a,b,c)}) == 3


def test_capturas_automaticas_simultaneas_no_duplican_serie_ni_lote(datos):
    with ThreadPoolExecutor(max_workers=4) as pool:
        respuestas = list(pool.map(lambda _: registrar(datos), range(4)))
    assert all(r.status_code == 200 for r in respuestas), [r.text for r in respuestas]
    assert len({r.json()['serie'] for r in respuestas}) == 4
    assert len({r.json()['id'] for r in respuestas}) == 4
    assert len({r.json()['lote'] for r in respuestas}) == 1


def test_serie_automatica_evade_codigo_manual_existente(datos):
    with datos['engine'].begin() as cx:
        reservado = cx.execute(text("SELECT nextval(pg_get_serial_sequence('unidades','id_unidad'))")).scalar_one()
        hoy = cx.execute(text("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date")).scalar_one()
    futura = f'NS-{hoy:%Y%m%d}-{reservado+2:08d}'
    manual = registrar(datos, serie=futura, lote=datos['lote'])
    assert manual.status_code == 200, manual.text
    automatico = registrar(datos)
    assert automatico.status_code == 200, automatico.text
    assert automatico.json()['serie'] != futura


def test_turno_cerrado_sigue_bloqueando_registro_automatico(datos):
    assert cerrar(datos).status_code == 200
    with datos['engine'].connect() as cx:
        antes = cx.execute(text('SELECT count(*) FROM unidades')).scalar_one()
    assert registrar(datos).status_code == 409
    with datos['engine'].connect() as cx:
        assert cx.execute(text('SELECT count(*) FROM unidades')).scalar_one() == antes
