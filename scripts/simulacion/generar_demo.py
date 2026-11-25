#!/usr/bin/env python3
"""Genera una copia independiente de la demo de NOVA SOUND con datos sintéticos."""
import argparse
import json
import random
import shutil
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
PRUEBAS = ("encendido", "audio", "carga", "bluetooth")
DISPOSICIONES = {
    "LIBERADA": "liberadas", "EN_RETENCION": "retenidas", "RETRABAJO": "retrabajo",
    "SCRAP": "scrap", "EMPACADA": "liberadas", "EMBARCADA": "liberadas",
}


def leer(nombre):
    return json.loads((FRONTEND / "mock" / f"{nombre}.json").read_text(encoding="utf-8"))


def evento(unidad, area, descripcion, resultado, usuario):
    unidad["historial"].append({
        "dia": unidad["dia"], "hora": unidad["hora"], "area": area,
        "evento": descripcion, "resultado": resultado, "usuario": usuario,
    })


def simular(cantidad, rng, hoy):
    ordenes = leer("ordenes")
    capacidades = leer("parametros")["capacidadCaja"]
    usuarios = leer("usuarios")
    defectos_base = leer("defectos")
    operador = usuarios[0]["nombre"]
    lider = next(u for u in usuarios if u["rol"] == "Líder de línea")
    inspector = next(u["nombre"] for u in usuarios if u["rol"] == "Calidad")
    estados_minimos = ["ENSAMBLADA", "FALLA_FUNCIONAL", "PROBADA", "EN_RETENCION", "RETRABAJO", "SCRAP"] + ["LIBERADA"] * 6
    estados = estados_minimos + rng.choices(
        ["ENSAMBLADA", "FALLA_FUNCIONAL", "PROBADA", "EN_RETENCION", "RETRABAJO", "SCRAP", "LIBERADA"],
        weights=[7, 5, 5, 4, 5, 2, 72], k=cantidad - len(estados_minimos),
    )
    unidades, pruebas, defectos = [], [], []
    para_enviar = []
    for indice, estado in enumerate(estados, 1):
        orden = rng.choice(ordenes)
        turno = rng.choice([1, 2])
        dia = 0 if indice <= len(estados_minimos) else rng.randrange(14)
        fecha = (hoy - timedelta(days=dia)).isoformat()
        hora = f"{rng.randrange(6 if turno == 1 else 14, 14 if turno == 1 else 22):02}:{rng.randrange(60):02}"
        unidad = {
            **{k: orden[k] for k in ("cliente", "modelo", "color", "linea")},
            "serie": f"SIM-NS-{indice:06}", "orden": orden["id"], "lote": f"SIM-{orden['id']}-{dia}-{turno}",
            "turno": turno, "dia": dia, "fechaRegistro": fecha, "hora": hora, "nueva": True,
            "estado": estado, "estadoOriginal": estado, "prueba": {}, "defectos": [],
            "historial": [], "caja": None, "embarque": None,
        }
        evento(unidad, "Producción", "Unidad ensamblada", "Registrada", operador)
        if estado != "ENSAMBLADA":
            unidad["prueba"] = dict.fromkeys(PRUEBAS, "Aprobada")
            observaciones = ""
            if estado == "FALLA_FUNCIONAL":
                prueba = rng.choice(PRUEBAS)
                unidad["prueba"][prueba] = "Falla"
                observaciones = f"Falla detectada en {prueba}."
            resultado = "Rechazada" if observaciones else "Aprobada"
            pruebas.append({
                **{k: unidad[k] for k in ("serie", "lote", "modelo", "linea", "turno", "hora")},
                "fecha": fecha, "usuario": operador, "resultado": resultado,
                "prueba": unidad["prueba"], "observaciones": observaciones,
            })
            evento(unidad, "Prueba funcional", "Prueba funcional", resultado, operador)
        if estado in DISPOSICIONES:
            unidad["inspector"] = inspector
            evento(unidad, "Calidad", "Inspección final", estado, inspector)
            if estado != "LIBERADA":
                ejemplo = rng.choice(defectos_base)
                defecto = {"categoria": ejemplo["categoria"], "defecto": ejemplo["defecto"]}
                unidad["defectos"] = [{**defecto, "causa": "Hallazgo simulado en inspección."}]
                defectos.append({
                    **{k: unidad[k] for k in ("dia", "turno", "linea", "modelo", "orden")},
                    **defecto, "cantidad": 1,
                })
                if estado == "EN_RETENCION":
                    unidad["retencion"] = {"dia": dia, "hora": hora, "motivo": defecto["defecto"], "observaciones": ""}
                if estado == "RETRABAJO":
                    unidad["retrabajo"] = {"dia": dia, "hora": hora, "estado": "Pendiente", "descripcion": "", "resultado": None, "observaciones": ""}
        if estado == "LIBERADA" and (indice <= 10 or indice > len(estados_minimos) and rng.random() < 0.65):
            para_enviar.append(unidad)
        unidades.append(unidad)

    cajas, embarques = empacar(para_enviar, capacidades, rng, hoy)
    grupos = defaultdict(Counter)
    for unidad in unidades:
        clave = tuple(unidad[k] for k in ("dia", "turno", "linea", "modelo", "orden", "lote"))
        grupo = grupos[clave]
        grupo["reportadas"] += 1
        estado = unidad["estado"]
        if estado in DISPOSICIONES:
            grupo[DISPOSICIONES[estado]] += 1
        if estado in {"EMPACADA", "EMBARCADA"}:
            grupo["recibidas"] += 1
    produccion = [
        {**dict(zip(("dia", "turno", "linea", "modelo", "orden", "lote"), clave)),
         **{k: grupo[k] for k in ("reportadas", "liberadas", "retenidas", "retrabajo", "scrap", "recibidas")},
         "meta": grupo["reportadas"] + rng.randint(0, 3)}
        for clave, grupo in grupos.items()
    ]
    for orden in ordenes:
        producidas = sum(u["orden"] == orden["id"] for u in unidades)
        orden["cantidad"] = producidas + rng.randint(1, 8)
        # La demo suma las unidades nuevas y las cajas actuales sobre estos contadores.
        orden["producidas"] = 0
        orden["cajas"] = dict.fromkeys(("preparadas", "pendientes", "embarcadas"), 0)

    incidencias = [
        {"id": f"SIM-INC-{i}", "fecha": hoy.isoformat(), "hora": "10:00", "linea": fila["linea"],
         "tipo": rng.choice(["Equipo", "Material", "Calidad"]), "severidad": rng.choice(["Baja", "Media", "Alta"]),
         "paro": rng.randint(5, 40), "motivo": "Incidencia operativa simulada.", "usuario": lider["nombre"], "estado": "Abierta"}
        for i, fila in enumerate(produccion[:max(1, cantidad // 12)], 1)
    ]
    fila = produccion[0]
    cierre = {"id": "SIM-CIERRE-1", "fecha": hoy.isoformat(), "linea": fila["linea"], "turno": fila["turno"],
              "estado": "Cerrado", "nota": "Cierre simulado.", "usuario": lider["nombre"]}
    solicitud = {
        "id": "SIM-AUT-1", "tipo": "Corrección de cierre", "fecha": hoy.isoformat(), "dia": 0, "hora": "14:05",
        "linea": fila["linea"], "turno": fila["turno"], "estado": "Pendiente", "orden": fila["orden"],
        "cierre": cierre["id"], "solicita": {k: lider[k] for k in ("nombre", "rol", "numEmpleado")},
        "cambio": {"campo": "Producción reportada", "de": fila["reportadas"], "a": fila["reportadas"] + 1},
        "motivo": "Revisar el conteo del turno simulado.", "operacion": True,
    }
    tickets = [
        {"id": f"T-{i:04}", "numEmpleado": usuario["numEmpleado"], "nombre": usuario["nombre"],
         "motivo": rng.choice(["Cuenta bloqueada", "Olvidó la contraseña"]), "estado": rng.choice(["Abierto", "Cerrado"]),
         "dia": rng.randrange(7), "hora": "09:00", "comentarios": ""}
        for i, usuario in enumerate(rng.sample(usuarios, min(len(usuarios), max(3, cantidad // 10))), 1)
    ]
    return {
        "unidades": unidades, "calidad": {"unidades": unidades}, "produccion": produccion,
        "defectos": defectos, "ordenes": ordenes, "tickets": tickets, "autorizaciones": [solicitud],
        "operacion": {"version": 1, "pruebas": pruebas, "incidencias": incidencias, "cierres": [cierre],
                      "cajas": cajas, "embarques": embarques},
    }


def empacar(unidades, capacidades, rng, hoy):
    cajas, embarques = [], []
    grupos = defaultdict(list)
    # Las primeras cuatro unidades liberadas aseguran un ejemplo de cada estado de embarque.
    lotes = [[u] for u in unidades[:4]]
    for u in unidades[4:]:
        grupos[u["orden"]].append(u)
    for grupo in grupos.values():
        capacidad = capacidades[grupo[0]["modelo"]]
        lotes.extend(grupo[i:i + capacidad] for i in range(0, len(grupo), capacidad))
    estados = ["Entregado", "Devuelto", "Pendiente", "Preparando"]
    destinos = ["Monterrey", "Saltillo", "Guadalajara", "Querétaro"]
    for indice, lote in enumerate(lotes, 1):
        primero = lote[0]
        estado = estados[indice - 1] if indice <= len(estados) else rng.choice(estados)
        fecha = max(u["fechaRegistro"] for u in lote)
        embarque = {
            "id": f"SIM-EMB-{indice:05}", "orden": primero["orden"], "cliente": primero["cliente"],
            "destino": rng.choice(destinos), "contenedor": f"SIM-CONT-{indice:05}",
            "estado": estado, "fecha": fecha, "cajas": [f"SIM-CX-{indice:05}"], "auditoria": [],
        }
        salio = estado in {"Entregado", "Devuelto"}
        if salio:
            embarque["fechaSalida"] = hoy.isoformat()
        caja = {
            "id": embarque["cajas"][0], **{k: primero[k] for k in ("orden", "cliente", "modelo", "color")},
            "estado": "Embarcada" if salio else "Cerrada", "capacidad": capacidades[primero["modelo"]],
            "unidades": [u["serie"] for u in lote], "fecha": fecha,
            "embarque": embarque["id"], "estibaVerificada": salio, "auditoria": [],
        }
        for u in lote:
            u["estado"] = u["estadoOriginal"] = "EMBARCADA" if salio else "EMPACADA"
            u["caja"] = {k: caja[k] for k in ("id", "estado", "capacidad", "unidades")}
            evento(u, "Empaque", "Caja cerrada", caja["id"], "Empaque")
            if salio:
                u["embarque"] = {**embarque, "referencia": embarque["id"]}
                u["historial"].append({"fecha": hoy.isoformat(), "dia": 0, "hora": "22:00", "area": "Embarques",
                                       "evento": "Salida de embarque", "resultado": estado, "usuario": "Embarques"})
        cajas.append(caja)
        embarques.append(embarque)
    return cajas, embarques


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cantidad", type=int, default=20, nargs="?", help="Número exacto de unidades. Mínimo 20.")
    parser.add_argument("--seed", type=int, help="Semilla para repetir los mismos datos.")
    parser.add_argument("--fecha", type=date.fromisoformat, help="Fecha de referencia ISO, por defecto hoy en Monterrey.")
    parser.add_argument("--salida", type=Path, default=Path("resultados/demo-simulada"), help="Carpeta nueva para la demo.")
    args = parser.parse_args()
    if args.cantidad < 20:
        parser.error("la cantidad mínima es 20")
    if args.salida.exists():
        parser.error("la carpeta de salida ya existe. Elige otra con --salida.")
    hoy = args.fecha or datetime.now(ZoneInfo("America/Monterrey")).date()
    datos = simular(args.cantidad, random.Random(args.seed), hoy)
    shutil.copytree(FRONTEND, args.salida, ignore=shutil.ignore_patterns("tests", "*.zip"))
    for nombre, valor in datos.items():
        (args.salida / "mock" / f"{nombre}.json").write_text(
            json.dumps(valor, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    config = args.salida / "js" / "config.js"
    config.write_text(config.read_text(encoding="utf-8").replace("export const ALMACEN_API = true;", "export const ALMACEN_API = false;"), encoding="utf-8")
    print(f"Demo: {args.salida.resolve()}")
    print(f"Unidades: {len(datos['unidades'])}, cajas: {len(datos['operacion']['cajas'])}, embarques: {len(datos['operacion']['embarques'])}")
    print(f'Servir con: python3 -m http.server 8010 --bind 127.0.0.1 --directory "{args.salida}"')


if __name__ == "__main__":
    main()
