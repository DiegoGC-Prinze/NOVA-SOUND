#!/usr/bin/env python3
"""Audita SQL + endpoint de trazabilidad de una corrida SIM (solo _test).

Uso: cd backend && python scripts/verificar_trazabilidad_simulacion.py --run-id ABCD123456
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

from simular_almacen_test import API, CAPACIDADES, REPO, app, service, validar_base


def verificar(run_id: str, db: str):
    manifest = REPO / 'docs' / 'evidencias' / f'almacen_simulacion_{run_id}.json'
    if not manifest.is_file():
        raise SystemExit(f'No se encuentra el manifiesto: {manifest}')
    info = json.loads(manifest.read_text(encoding='utf-8'))
    if info.get('tag') != run_id:
        raise SystemExit('El ID de la evidencia no coincide con el solicitado')
    motor = validar_base(db)
    errores = []
    contadores = Counter()
    muestras = {}
    try:
        with motor.connect() as cx:
            unidades = list(cx.execute(text('''
                SELECT u.id_unidad, u.numero_serie, u.estado,
                       u.id_color, u.id_turno, u.id_linea, u.id_caja,
                       l.id_orden, o.id_cliente, o.id_modelo, o.id_color AS color_orden,
                       cl.mezcla_colores, m.nombre AS modelo,
                       c.estado AS estado_caja, c.capacidad AS capacidad_caja,
                       c.id_orden AS orden_caja, c.id_cliente AS cliente_caja,
                       c.id_modelo AS modelo_caja, c.id_embarque,
                       e.id_orden AS orden_embarque, e.id_cliente AS cliente_embarque,
                       e.estado AS estado_embarque,
                       q.estado AS estado_calidad
                FROM unidades u
                JOIN lote l ON l.id_lote=u.id_lote
                JOIN ordenes o ON o.id_orden=l.id_orden
                JOIN clientes cl ON cl.id_cliente=o.id_cliente
                JOIN modelos m ON m.id_modelo=o.id_modelo
                LEFT JOIN cajas c ON c.id_caja=u.id_caja
                LEFT JOIN embarques e ON e.id_embarque=c.id_embarque
                LEFT JOIN LATERAL (
                    SELECT estado FROM calidad q0 WHERE q0.id_unidad=u.id_unidad
                    ORDER BY q0.fecha DESC NULLS LAST,q0.id_calidad DESC LIMIT 1
                ) q ON TRUE
                WHERE u.numero_serie LIKE :prefijo
                ORDER BY u.id_unidad
            '''), {'prefijo': f'SIM-{run_id}-%'}).mappings())
            unidad_ids = [r['id_unidad'] for r in unidades]
            acciones = defaultdict(list)
            if unidad_ids:
                for r in cx.execute(text('''
                    SELECT b.id_registro_afectado, b.accion
                    FROM bitacora_general b
                    WHERE b.tabla_afectada='unidades'
                      AND b.id_registro_afectado = ANY(:ids)
                    ORDER BY b.id_bitacora
                '''), {'ids': unidad_ids}).mappings():
                    acciones[r['id_registro_afectado']].append(r['accion'])
            caja_count = Counter(r['id_caja'] for r in unidades if r['id_caja'] is not None)
            caja_ids = set(caja_count)
            orden_ids = set()
            modelos = set()
            lineas = set()
            turnos = set()
            for r in unidades:
                serie = r['numero_serie']
                estado = r['estado']
                estado_calidad = r['estado_calidad']
                modelo = r['modelo']
                modelos.add(modelo)
                orden_ids.add(r['id_orden'])
                lineas.add(r['id_linea'])
                turnos.add(r['id_turno'])
                contadores[estado] += 1
                if estado_calidad is None:
                    errores.append(f'{serie}: falta evaluación de Calidad')
                if modelo not in CAPACIDADES:
                    errores.append(f'{serie}: modelo no oficial {modelo!r}')
                if r['id_caja'] is None:
                    if estado not in {'LIBERADA', 'EN_RETENCION', 'EN_RETRABAJO', 'SCRAP'}:
                        errores.append(f'{serie}: unidad fuera de caja con estado {estado}')
                    if acciones[r['id_unidad']]:
                        errores.append(f'{serie}: historial de caja sin caja actual; revisar posible retiro')
                    muestras.setdefault('sin_caja', serie)
                    continue
                if estado_calidad != 'LIBERADA':
                    errores.append(f'{serie}: empacada sin liberación vigente de Calidad')
                if (r['orden_caja'], r['cliente_caja'], r['modelo_caja']) != (r['id_orden'], r['id_cliente'], r['id_modelo']):
                    errores.append(f'{serie}: caja incompatible con orden, cliente o modelo')
                if not r['mezcla_colores'] and r['id_color'] != r['color_orden']:
                    errores.append(f'{serie}: cliente sin mezcla, color distinto al de la orden')
                if r['capacidad_caja'] != CAPACIDADES.get(modelo):
                    errores.append(f'{serie}: capacidad no oficial para {modelo}')
                if caja_count[r['id_caja']] > r['capacidad_caja']:
                    errores.append(f'{serie}: sobrecapacidad de caja {r["id_caja"]}')
                estado_caja = r['estado_caja']
                actos = acciones[r['id_unidad']]
                if not actos or actos[0] != 'AGREGAR_UNIDAD':
                    errores.append(f'{serie}: falta evento AGREGAR_UNIDAD inicial')
                if estado_caja == 'EMBARCADA':
                    if estado != 'EMBARCADA' or r['estado_embarque'] != 'ENVIADO':
                        errores.append(f'{serie}: salida sin estados consistentes')
                    if (r['id_orden'], r['id_cliente']) != (r['orden_embarque'], r['cliente_embarque']):
                        errores.append(f'{serie}: embarque de cliente u orden diferente')
                    if actos != ['AGREGAR_UNIDAD','CERRAR_CAJA','ASIGNAR_EMBARQUE','REGISTRAR_SALIDA']:
                        errores.append(f'{serie}: auditoría de envío incompleta {actos}')
                    muestras.setdefault('embarcada', serie)
                elif estado_caja in ('EN_PROCESO','CERRADA'):
                    if estado != 'EMPACADA':
                        errores.append(f'{serie}: estado de unidad {estado} no corresponde a caja {estado_caja}')
                    if estado_caja == 'CERRADA' and 'CERRAR_CAJA' not in actos:
                        errores.append(f'{serie}: falta evento CERRAR_CAJA')
                    muestras.setdefault('cerrada' if estado_caja == 'CERRADA' else 'en_proceso', serie)
                else:
                    errores.append(f'{serie}: caja en estado inesperado {estado_caja}')
            if len(unidades) != info['unidades_generadas']:
                errores.append(f'Conteo de unidades {len(unidades)} != {info["unidades_generadas"]}')
            if len(orden_ids) != 8:
                errores.append(f'Esperadas 8 órdenes sintéticas; encontradas {len(orden_ids)}')
            if modelos != set(CAPACIDADES):
                errores.append(f'Modelos simulados incompletos: {modelos}')
            if len(lineas) < 3 or len(turnos) < 2:
                errores.append(f'No se cubrieron 3 líneas y 2 turnos: {lineas}, {turnos}')
            if len(caja_ids) != sum(len(o.get('cajas', [])) for o in info['ordenes']):
                errores.append('El número de cajas no coincide con el manifiesto')
        # Comprobación de contrato HTTP en los cuatro estados representativos.
        motor_anterior = service.engine
        service.engine = motor
        try:
            with TestClient(app) as api:
                for categoria, serie in muestras.items():
                    respuesta = api.get(f'{API}/trazabilidad/{serie}')
                    if respuesta.status_code != 200:
                        errores.append(f'{serie}: HTTP {respuesta.status_code} en trazabilidad')
                    elif respuesta.json()['numero_serie'] != serie:
                        errores.append(f'{serie}: API devolvió otro número de serie')
                    elif categoria == 'embarcada' and not respuesta.json().get('id_embarque'):
                        errores.append(f'{serie}: falta vínculo de embarque en API')
        finally:
            service.engine = motor_anterior
    finally:
        motor.dispose()
    salida = {
        'run_id': run_id, 'db': db, 'valido': not errores,
        'unidades_verificadas': len(unidades),
        'ordenes_verificadas': len(orden_ids),
        'cajas_verificadas': len(caja_ids),
        'modelos': sorted(modelos), 'lineas': sorted(lineas), 'turnos': sorted(turnos),
        'estados': dict(contadores), 'muestras': muestras, 'errores': errores,
    }
    ruta = REPO / 'docs' / 'evidencias' / f'almacen_trazabilidad_{run_id}.json'
    ruta.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Unidades verificadas: {len(unidades)} | Órdenes: {len(orden_ids)} | Cajas: {len(caja_ids)}')
    print('Estados:', dict(contadores))
    print('Muestras API:', muestras)
    print('Errores:', len(errores))
    for e in errores[:20]:
        print('ERROR:', e)
    if len(errores) > 20:
        print(f'... y {len(errores) - 20} más')
    print('Reporte:', ruta)
    if errores:
        raise SystemExit(1)
    print('TRAZABILIDAD VALIDADA: SQL + API, datos exclusivos de simulación')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-id', required=True)
    p.add_argument('--db', default='nova_sounds_test')
    args = p.parse_args()
    run_id = args.run_id.upper()
    if not re.fullmatch(r'[A-F0-9]{10}', run_id):
        p.error('--run-id debe ser el ID hexadecimal de 10 caracteres generado por el simulador')
    verificar(run_id, args.db)


if __name__ == '__main__':
    main()
