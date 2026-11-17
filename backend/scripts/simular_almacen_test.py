#!/usr/bin/env python3
"""Genera datos sintéticos de NOVA SOUND y mueve cajas usando la API real.

PRECAUCION: solo sobre base PostgreSQL cuyo nombre termina en _test.
No borra registros previos ni modifica otros módulos.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.db.database import DATABASE_URL  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.almacen import service  # noqa: E402
from app.modules.almacen.auth import Actor, obtener_actor  # noqa: E402

CAPACIDADES = {"NS-MINI": 12, "NS-SPORT": 8, "NS-PRO": 6, "NS-MAX": 4}
API = "/api/v1/almacen"


def consulta(cx, sql: str, **params):
    return cx.execute(text(sql), params).scalar_one()


def validar_base(nombre: str):
    if not nombre.endswith("_test") or nombre.lower() == "nova_sounds":
        raise SystemExit("SEGURIDAD: solo se admite una base separada terminada en _test")
    if not DATABASE_URL.drivername.startswith("postgresql"):
        raise SystemExit("Se requiere conexión PostgreSQL")
    if not DATABASE_URL.username or not DATABASE_URL.password:
        raise SystemExit("Configura DB_USER y DB_PASSWORD en backend/.env antes de ejecutar")
    if DATABASE_URL.database == nombre:
        print("Aviso: backend/.env apunta a la base de pruebas; no es necesario cambiarla.")
    motor = create_engine(DATABASE_URL.set(database=nombre), pool_pre_ping=True)
    with motor.connect() as cx:
        db = consulta(cx, "SELECT current_database()")
        assert db == nombre, f"Base incorrecta: {db}"
        columnas = set(cx.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='cajas'
        """)).scalars())
        if not {"id_orden", "capacidad", "fecha_creacion", "fecha_cierre"}.issubset(columnas):
            raise SystemExit("Falta la migración 04 de Almacén en la base _test")
        modelos = {nombre: id_modelo for nombre, id_modelo in cx.execute(text("SELECT nombre,id_modelo FROM modelos"))}
        if set(modelos) != set(CAPACIDADES):
            raise SystemExit(f"Catálogo inesperado: {list(modelos)}")
        if not consulta(cx, "SELECT COUNT(*) FROM roles WHERE LOWER(nombre)='administrador'"):
            raise SystemExit("No existe rol Administrador en los datos de prueba")
        for tabla in ("colores", "linea", "turnos"):
            if consulta(cx, f"SELECT COUNT(*) FROM {tabla}") == 0:
                raise SystemExit(f"Falta catálogo inicial: {tabla}")
    return motor


def estado_sintetico(numero: int, capacidad: int) -> str:
    # Garantiza al menos capacidad + 2 liberadas para caja cerrada y abierta.
    if numero < capacidad + 2:
        return "LIBERADA"
    indice = numero % 20
    return ("LIBERADA" if indice < 14 else
            "EN_RETENCION" if indice < 17 else
            "EN_RETRABAJO" if indice < 19 else "SCRAP")


def poblar(motor, tag: str, por_orden: int):
    """Inserciones completamente transaccionales y referenciadas por IDs devueltos."""
    resumen = {"tag": tag, "por_orden": por_orden, "ordenes": [], "estados_produccion": {}}
    totales = Counter()
    with motor.begin() as cx:
        modelos = {nombre: id_modelo for nombre, id_modelo in cx.execute(text("SELECT nombre,id_modelo FROM modelos"))}
        colores = list(cx.execute(text("SELECT id_color FROM colores ORDER BY id_color")).scalars())
        lineas = list(cx.execute(text("SELECT id_linea FROM linea ORDER BY id_linea")).scalars())
        turnos = list(cx.execute(text("SELECT id_turno FROM turnos ORDER BY id_turno")).scalars())
        rol = consulta(cx, "SELECT id_rol FROM roles WHERE LOWER(nombre)='administrador' LIMIT 1")
        usuario = consulta(cx, """
            INSERT INTO usuarios(id_rol,nombre,usuario,contrasena)
            VALUES (:rol,'SIM Operador de Almacén',:login,'CUENTA_SOLO_DE_SIMULACION_NO_LOGIN')
            RETURNING id_usuario
        """, rol=rol, login=f"sim_{tag}")
        resumen["usuario_simulado"] = usuario
        clientes = []
        for nombre, mezcla in (("Cliente mezcla permitida", True), ("Cliente mezcla prohibida", False)):
            cliente = consulta(cx, """
                INSERT INTO clientes(nombre,mezcla_colores)
                VALUES (:nombre,:mezcla) RETURNING id_cliente
            """, nombre=f"SIM {tag} {nombre}", mezcla=mezcla)
            clientes.append((cliente, mezcla))
        for i, (modelo, capacidad) in enumerate(CAPACIDADES.items()):
            for j, (cliente, mezcla) in enumerate(clientes):
                color_orden = colores[(i + j) % len(colores)]
                linea = lineas[(i + j) % len(lineas)]
                orden = consulta(cx, """
                    INSERT INTO ordenes(id_cliente,id_modelo,id_color,id_linea,cantidad,fecha_compromiso)
                    VALUES (:cliente,:modelo,:color,:linea,:cantidad,:compromiso)
                    RETURNING id_orden
                """, cliente=cliente, modelo=modelos[modelo], color=color_orden,
                    linea=linea, cantidad=por_orden,
                    compromiso=date.today() + timedelta(days=3+i))
                lote = consulta(cx, """
                    INSERT INTO lote(id_orden,cantidad_acordada,estado)
                    VALUES (:orden,:cantidad,'EN_PROCESO') RETURNING id_lote
                """, orden=orden, cantidad=por_orden)
                reg = {"id_orden": orden, "id_lote": lote, "id_cliente": cliente,
                       "id_modelo": modelos[modelo], "modelo": modelo, "capacidad": capacidad,
                       "mezcla_colores": mezcla, "liberadas": [], "bloqueadas": [], "cajas": []}
                for n in range(por_orden):
                    estado = estado_sintetico(n, capacidad)
                    turno = turnos[n % len(turnos)]
                    color = colores[(n + i) % len(colores)] if mezcla else color_orden
                    serie = f"SIM-{tag}-{i+1}{j+1}-{n+1:05d}"
                    unidad = consulta(cx, """
                        INSERT INTO unidades(id_color,id_linea,id_turno,id_lote,estado,numero_serie)
                        VALUES (:color,:linea,:turno,:lote,:estado,:serie)
                        RETURNING id_unidad
                    """, color=color, linea=linea, turno=turno, lote=lote,
                        estado=estado, serie=serie)
                    cx.execute(text("""
                        INSERT INTO pruebas(id_unidad,resultado,detalles_prueba)
                        VALUES (:unidad,:resultado,:detalle)
                    """), {"unidad": unidad,
                           "resultado": "APROBADO" if estado == "LIBERADA" else "RECHAZADO",
                           "detalle": f"SIM {tag}: verificación automática; {estado}"})
                    cx.execute(text("""
                        INSERT INTO calidad(id_unidad,id_usuario,estado)
                        VALUES (:unidad,:usuario,:estado)
                    """), {"unidad": unidad, "usuario": usuario, "estado": estado})
                    totales[estado] += 1
                    if estado == "LIBERADA":
                        reg["liberadas"].append(serie)
                    else:
                        reg["bloqueadas"].append({"serie": serie, "estado": estado})
                resumen["ordenes"].append(reg)
    resumen["estados_produccion"] = dict(totales)
    resumen["unidades_generadas"] = sum(totales.values())
    return resumen


def exigir(res, status: int, etiqueta: str):
    if res.status_code != status:
        raise RuntimeError(f"{etiqueta}: esperado HTTP {status}, obtenido {res.status_code}: {res.text[:350]}")
    return res.json()



def recuperar_cajas_existentes(motor, orden, indice):
    """Permite reanudar un lote si la pasada anterior completó órdenes enteras.

    Para evitar duplicados, nunca crea cajas nuevas para una orden a medio
    procesar. Se valida tanto la cantidad como el contenido de ambas cajas.
    """
    with motor.connect() as cx:
        cajas = list(cx.execute(text("""
            SELECT c.id_caja, c.estado, c.id_embarque,
                   e.estado AS estado_embarque, e.id_orden AS embarque_orden
            FROM cajas c LEFT JOIN embarques e ON e.id_embarque=c.id_embarque
            WHERE c.id_orden=:id_orden ORDER BY c.id_caja
        """), {"id_orden": orden["id_orden"]}).mappings())
        if not cajas:
            return None
        if len(cajas) != 2:
            raise RuntimeError(
                f"Orden {orden['id_orden']}: hay {len(cajas)} cajas previas, "
                "se requieren exactamente 2 para reanudar con seguridad. "
                "No se realizaron nuevas operaciones para esta orden."
            )
        primera, abierta = cajas
        esperado = "EMBARCADA" if indice % 2 == 0 else "CERRADA"
        if primera["estado"] != esperado or abierta["estado"] != "EN_PROCESO":
            raise RuntimeError(
                f"Orden {orden['id_orden']}: estados previos no recuperables: "
                f"{primera['estado']}, {abierta['estado']}"
            )
        if (indice % 2 == 0) != (primera["id_embarque"] is not None):
            raise RuntimeError(f"Orden {orden['id_orden']}: vínculo de embarque inesperado")
        if indice % 2 == 0 and (primera["estado_embarque"] != "ENVIADO" or
                                primera["embarque_orden"] != orden["id_orden"]):
            raise RuntimeError(f"Orden {orden['id_orden']}: embarque no enviado o incongruente")
        if abierta["id_embarque"] is not None:
            raise RuntimeError(f"Orden {orden['id_orden']}: caja abierta con embarque")
        for caja, series_esperadas in (
            (primera, orden["liberadas"][:orden["capacidad"]]),
            (abierta, orden["liberadas"][orden["capacidad"]:orden["capacidad"] + 2]),
        ):
            series_actuales = list(cx.execute(text("""
                SELECT numero_serie FROM unidades
                WHERE id_caja=:id_caja ORDER BY id_unidad
            """), {"id_caja": caja["id_caja"]}).scalars())
            if series_actuales != series_esperadas:
                raise RuntimeError(
                    f"Caja {caja['id_caja']}: contenido distinto al previsto; "
                    "se requiere revisión manual, sin crear nuevas cajas"
                )
        evento = {
            "id_caja": primera["id_caja"],
            "estado": esperado,
            "series": orden["liberadas"][:orden["capacidad"]],
        }
        if primera["id_embarque"] is not None:
            evento["id_embarque"] = primera["id_embarque"]
        parcial = {
            "id_caja": abierta["id_caja"],
            "estado": "EN_PROCESO",
            "series": orden["liberadas"][orden["capacidad"]:orden["capacidad"] + 2],
        }
        return evento, parcial


def validar_reanudacion(motor, resumen):
    """Confirma que el manifiesto corresponde a un lote íntegro de la base _test."""
    prefijo = f"SIM-{resumen['tag']}-%"
    esperado = resumen["unidades_generadas"]
    if len(resumen["ordenes"]) != 8 or esperado != 8 * resumen["por_orden"]:
        raise SystemExit("Manifiesto de simulación incompleto; no se reanuda")
    with motor.connect() as cx:
        reales = consulta(cx, "SELECT count(*) FROM unidades WHERE numero_serie LIKE :p", p=prefijo)
        if reales != esperado:
            raise SystemExit(f"Manifiesto incompleto: {reales} unidades en BD, {esperado} esperadas")
        for orden in resumen["ordenes"]:
            id_orden = orden["id_orden"]
            registrado = consulta(cx, "SELECT count(*) FROM ordenes WHERE id_orden=:id", id=id_orden)
            if registrado != 1:
                raise SystemExit(f"Orden {id_orden} del manifiesto no existe")
            from_lote = consulta(cx, """
                SELECT COUNT(*) FROM unidades
                WHERE id_lote=:lote AND numero_serie LIKE :p
            """, lote=orden["id_lote"], p=prefijo)
            if from_lote != resumen["por_orden"]:
                raise SystemExit(f"Lote de orden {id_orden} no coincide; reanudación cancelada")


def simular_flujo(motor, resumen):
    """Ejecuta HTTP real mediante TestClient, preservando auditoría de service."""
    previo = app.dependency_overrides.get(obtener_actor)
    tenia_previo = obtener_actor in app.dependency_overrides
    motor_previo = service.engine
    service.engine = motor
    app.dependency_overrides[obtener_actor] = lambda: Actor(resumen["usuario_simulado"], "Administrador")
    try:
        with TestClient(app) as api:
            for indice, orden in enumerate(resumen["ordenes"]):
                cap = orden["capacidad"]
                if len(orden["liberadas"]) < cap + 2:
                    raise RuntimeError(f"Faltan unidades liberadas en orden {orden['id_orden']}")
                recuperadas = recuperar_cajas_existentes(motor, orden, indice)
                if recuperadas is not None:
                    evento, parcial = recuperadas
                    orden["cajas"] = [evento, parcial]
                    caja = evento["id_caja"]
                    print(f"REANUDADA orden {orden['id_orden']} | cajas existentes: {caja}, {parcial['id_caja']}")
                else:
                    nueva = exigir(api.post(API + "/cajas", json={"id_orden": orden["id_orden"]}),
                                   201, "Crear caja cerrable")
                    caja = nueva["id_caja"]
                    if orden["bloqueadas"]:
                        prohibida = orden["bloqueadas"][0]["serie"]
                        exigir(api.post(f"{API}/cajas/{caja}/unidades", json={"numero_serie": prohibida}),
                               409, "Rechazar unidad bloqueada por Calidad")
                    for serie in orden["liberadas"][:cap]:
                        exigir(api.post(f"{API}/cajas/{caja}/unidades", json={"numero_serie": serie}),
                               200, "Empacar unidad")
                    cerrada = exigir(api.post(f"{API}/cajas/{caja}/cerrar"), 200, "Cerrar caja")
                    assert cerrada["estado"] == "CERRADA"
                    evento = {"id_caja": caja, "estado": "CERRADA", "series": orden["liberadas"][:cap]}
                    if indice % 2 == 0:
                        embarque = exigir(api.post(API + "/embarques", json={
                            "id_orden": orden["id_orden"],
                            "referencia": f"SIM-{resumen['tag']}-{indice + 1:02d}"
                        }), 201, "Crear embarque")
                        eid = embarque["id_embarque"]
                        exigir(api.post(f"{API}/embarques/{eid}/cajas/{caja}"), 200, "Asignar caja")
                        salida = exigir(api.post(f"{API}/embarques/{eid}/salida"), 200, "Registrar salida")
                        assert salida["estado"] == "ENVIADO"
                        evento.update({"id_embarque": eid, "estado": "EMBARCADA"})
                    orden["cajas"].append(evento)
                    # Una segunda caja queda abierta para mostrar pendientes reales en panel.
                    abierta = exigir(api.post(API + "/cajas", json={"id_orden": orden["id_orden"]}),
                                     201, "Crear caja en proceso")
                    caja_abierta = abierta["id_caja"]
                    for serie in orden["liberadas"][cap:cap+2]:
                        exigir(api.post(f"{API}/cajas/{caja_abierta}/unidades", json={"numero_serie": serie}),
                               200, "Empacar parcial")
                    orden["cajas"].append({"id_caja": caja_abierta, "estado": "EN_PROCESO",
                                           "series": orden["liberadas"][cap:cap+2]})
                # Validación explícita del endpoint de trazabilidad.
                primera = orden["liberadas"][0]
                traza = exigir(api.get(f"{API}/trazabilidad/{primera}"), 200, "Consultar trazabilidad")
                assert traza["id_orden"] == orden["id_orden"]
                assert traza["id_caja"] == caja
                # Trazabilidad devuelve el estado de la UNIDAD, no el de la caja.
                estado_unidad_esperado = "EMBARCADA" if evento["estado"] == "EMBARCADA" else "EMPACADA"
                assert traza["estado"] == estado_unidad_esperado, (
                    f"Serie {primera}: unidad {traza['estado']}, "
                    f"esperada {estado_unidad_esperado} (caja {evento['estado']})"
                )
                acciones = [e["accion"] for e in traza["historial_almacen"]]
                esperadas = ["AGREGAR_UNIDAD", "CERRAR_CAJA"]
                if evento["estado"] == "EMBARCADA":
                    esperadas += ["ASIGNAR_EMBARQUE", "REGISTRAR_SALIDA"]
                assert acciones == esperadas, f"Auditoría distinta: {acciones!r} != {esperadas!r}"
            resumen["panel_despues"] = exigir(api.get(API + "/panel"), 200, "Panel")
            resumen["embarques_api"] = len(exigir(api.get(API + "/embarques"), 200, "Listar embarques"))
    finally:
        service.engine = motor_previo
        if tenia_previo:
            app.dependency_overrides[obtener_actor] = previo
        else:
            app.dependency_overrides.pop(obtener_actor, None)


def guardar(resumen, ruta):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Evidencia: {ruta}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.getenv("ALMACEN_TEST_DB_NAME", "nova_sounds_test"))
    parser.add_argument("--por-orden", type=int, default=40, help="Unidades por cada una de las 8 órdenes")
    parser.add_argument("--ejecutar", action="store_true", help="Confirma escrituras SOLO en base _test")
    parser.add_argument("--reanudar", metavar="RUN_ID", help="Continúa el lote existente sin generar unidades nuevas")
    parser.add_argument("--flujo", action="store_true", help="Además: usar endpoints reales para cajas y embarques")
    args = parser.parse_args()
    if not 16 <= args.por_orden <= 1000:
        parser.error("--por-orden debe estar entre 16 y 1000")
    if args.flujo and not args.ejecutar:
        parser.error("--flujo requiere --ejecutar")
    motor = validar_base(args.db)
    try:
        print(f"Destino VALIDADO: {args.db} | 8 órdenes, {8 * args.por_orden if not args.reanudar else 'lote existente'} unidades")
        if not args.ejecutar:
            print("MODO PREVISUALIZACIÓN: sin escrituras. Agrega --ejecutar --flujo para simular.")
            return
        if args.reanudar:
            tag = args.reanudar.upper()
            if len(tag) != 10 or any(c not in "0123456789ABCDEF" for c in tag):
                raise SystemExit("RUN_ID inválido: se requieren 10 caracteres hexadecimales")
            ruta = REPO / "docs" / "evidencias" / f"almacen_simulacion_{tag}.json"
            if not ruta.is_file():
                raise SystemExit(f"No existe manifiesto para reanudar: {ruta}")
            resumen = json.loads(ruta.read_text(encoding="utf-8"))
            if resumen.get("tag") != tag or resumen.get("por_orden") is None:
                raise SystemExit("Manifiesto inválido o corrupto")
            validar_reanudacion(motor, resumen)
            print(f"REANUDANDO {tag} SIN INSERTAR unidades ni órdenes")
        else:
            tag = uuid4().hex[:10].upper()
            ruta = REPO / "docs" / "evidencias" / f"almacen_simulacion_{tag}.json"
            resumen = poblar(motor, tag, args.por_orden)
            guardar(resumen, ruta)  # Guardar incluso si la fase HTTP falla; facilita diagnosticar.
        if args.flujo:
            simular_flujo(motor, resumen)
            guardar(resumen, ruta)
        print(f"SIMULACIÓN GENERADA. RUN_ID={tag}")
        print(f"Estados iniciales: {resumen['estados_produccion']}")
        print(f"Órdenes: {len(resumen['ordenes'])} | Cajas creadas: {sum(len(o['cajas']) for o in resumen['ordenes'])}")
        print("Siguiente: python scripts/verificar_trazabilidad_simulacion.py --run-id", tag)
    finally:
        motor.dispose()


if __name__ == "__main__":
    main()
