#!/usr/bin/env python3
"""Genera escenarios industriales sinteticos reproducibles, sin tocar bases de datos.

Etapa 1: PLANIFICACION (JSON+CSV). No llama a FastAPI ni escribe en PostgreSQL.
Etapa 2: un cliente HTTP aplicara los eventos respetando contratos y permisos.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ESTADOS = (
    "LIBERADA", "FALLA_FUNCIONAL", "EN_RETENCION", "EN_RETRABAJO", "SCRAP"
)


def verificar_configuracion(cfg: dict) -> None:
    if not 1 <= cfg["dias_operativos"] <= 366:
        raise ValueError("dias_operativos debe estar entre 1 y 366")
    if not cfg["lineas"] or not cfg["turnos"] or not cfg["dias_semana_laborables"]:
        raise ValueError("Se requieren lineas, turnos y dias laborables")
    if not set(cfg["dias_semana_laborables"]).issubset(set(range(7))):
        raise ValueError("Los dias laborables deben usar 0=lunes..6=domingo")
    if cfg["meta_unidades_por_turno"] < 1 or cfg["minutos_por_turno"] < 1:
        raise ValueError("La meta y los minutos por turno deben ser positivos")
    modelos = cfg["modelos"]
    if not modelos or abs(sum(m["peso"] for m in modelos) - 1) > 0.0000001:
        raise ValueError("Los pesos de modelos deben sumar 1")
    if any(m["peso"] < 0 or m["factor_fallas"] <= 0 or m["capacidad_caja"] <= 0 for m in modelos):
        raise ValueError("Modelos: peso, factor_fallas o capacidad invalidos")
    for section in ("operacion", "calidad"):
        for key, val in cfg[section].items():
            if key.startswith("probabilidad_") and not 0 <= val <= 1:
                raise ValueError(f"{section}.{key} fuera de [0,1]")
    q = cfg["calidad"]
    if q["probabilidad_scrap_dado_defecto"] + q["probabilidad_retrabajo_dado_defecto"] > 1:
        raise ValueError("Scrap y retrabajo no pueden sumar mas de 100%")
    for name in ("duracion_paro_minutos", "perdida_capacidad_por_material", "factor_ritmo_normal"):
        lo, hi = cfg["operacion"][name]
        if lo < 0 or hi < lo:
            raise ValueError(f"Rango invalido: operacion.{name}")
    if cfg["operacion"]["duracion_paro_minutos"][1] > cfg["minutos_por_turno"]:
        raise ValueError("Un paro no debe exceder el turno")
    if cfg["operacion"]["perdida_capacidad_por_material"][1] > 1:
        raise ValueError("La perdida por material debe ser <= 1")
    date.fromisoformat(cfg["fecha_inicio"])


def fechas_operativas(inicio: date, n: int, dias: list[int]):
    actual = inicio
    emitidos = 0
    while emitidos < n:
        if actual.weekday() in dias:
            yield actual
            emitidos += 1
        actual += timedelta(days=1)


def simular(cfg: dict, *, semilla: int | None = None) -> dict:
    verificar_configuracion(cfg)
    seed = cfg["semilla"] if semilla is None else semilla
    rng = random.Random(seed)
    op = cfg["operacion"]
    calidad = cfg["calidad"]
    modelos = cfg["modelos"]
    meta = cfg["meta_unidades_por_turno"]
    minutos = cfg["minutos_por_turno"]
    unidades = []
    turnos = []
    incidentes = []
    correlativo = 0
    fechas = list(fechas_operativas(date.fromisoformat(cfg["fecha_inicio"]),
                                    cfg["dias_operativos"], cfg["dias_semana_laborables"]))

    for fecha in fechas:
        for linea in cfg["lineas"]:
            for turno in cfg["turnos"]:
                paro = rng.random() < op["probabilidad_paro_equipo_por_turno"]
                material = rng.random() < op["probabilidad_faltante_material_por_turno"]
                parada_min = rng.randint(*op["duracion_paro_minutos"]) if paro else 0
                perdida_material = rng.uniform(*op["perdida_capacidad_por_material"]) if material else 0
                factor_ritmo = rng.uniform(*op["factor_ritmo_normal"])
                produccion = round(meta * factor_ritmo * (1 - parada_min / minutos) * (1 - perdida_material))
                produccion = max(0, produccion)
                eventos = []
                if paro:
                    eventos.append("PARO_EQUIPO")
                    incidentes.append({"fecha": fecha.isoformat(), "linea": linea,
                                       "turno": turno, "tipo": "PARO_EQUIPO",
                                       "minutos_paro": parada_min,
                                       "descripcion": "Paro no programado reduce capacidad disponible"})
                if material:
                    eventos.append("FALTANTE_MATERIAL")
                    incidentes.append({"fecha": fecha.isoformat(), "linea": linea,
                                       "turno": turno, "tipo": "FALTANTE_MATERIAL",
                                       "minutos_paro": 0,
                                       "descripcion": "Suministro intermitente reduce produccion del turno"})
                turnos.append({"fecha": fecha.isoformat(), "linea": linea, "turno": turno,
                               "meta": meta, "producidas": produccion,
                               "paro_minutos": parada_min, "perdida_material": round(perdida_material, 4),
                               "eventos": eventos})

                for _ in range(produccion):
                    correlativo += 1
                    modelo = rng.choices(modelos, weights=[m["peso"] for m in modelos], k=1)[0]
                    factor_def = modelo["factor_fallas"]
                    if material:
                        factor_def *= calidad["factor_defectos_con_faltante_material"]
                    if paro:
                        factor_def *= calidad["factor_defectos_tras_paro_equipo"]

                    falla_funcional = rng.random() < min(1, calidad["probabilidad_falla_funcional"] * factor_def)
                    prueba = "RECHAZADA" if falla_funcional else "APROBADA"
                    defecto = None
                    retrabajo = None
                    if falla_funcional:
                        estado = "FALLA_FUNCIONAL"
                        defecto = rng.choice(["AUDIO", "ENCENDIDO", "CARGA", "BLUETOOTH"])
                    elif rng.random() < min(1, calidad["probabilidad_defecto_inspeccion"] * factor_def):
                        defecto = rng.choice(["APARIENCIA", "ENSAMBLE", "ETIQUETADO", "FUNCIONAL"])
                        eleccion = rng.random()
                        if eleccion < calidad["probabilidad_scrap_dado_defecto"]:
                            estado = "SCRAP"
                        elif eleccion < (calidad["probabilidad_scrap_dado_defecto"] +
                                         calidad["probabilidad_retrabajo_dado_defecto"]):
                            retrabajo = "CORREGIDO" if rng.random() < calidad["probabilidad_exito_retrabajo"] else "PENDIENTE"
                            estado = "LIBERADA" if retrabajo == "CORREGIDO" else "EN_RETRABAJO"
                        else:
                            estado = "EN_RETENCION"
                    else:
                        estado = "LIBERADA"
                    unidades.append({
                        "numero_serie": f"SIM-{seed}-{correlativo:06d}",
                        "fecha_simulada": fecha.isoformat(), "linea": linea,
                        "turno": turno, "modelo": modelo["nombre"],
                        "estado_previsto": estado,
                        "prueba_funcional_prevista": prueba,
                        "defecto_previsto": defecto,
                        "retrabajo_previsto": retrabajo,
                        "eventos_turno": eventos,
                    })

    estados = Counter(u["estado_previsto"] for u in unidades)
    total_meta = sum(t["meta"] for t in turnos)
    total_producidas = len(unidades)
    total_primera = sum(u["estado_previsto"] == "LIBERADA" and not u["retrabajo_previsto"]
                        for u in unidades)
    resumen = {
        "dias_operativos": len(fechas),
        "fecha_inicio": fechas[0].isoformat(),
        "fecha_fin": fechas[-1].isoformat(),
        "turnos_simulados": len(turnos),
        "meta_total": total_meta,
        "producidas": total_producidas,
        "cumplimiento_meta_pct": round(100 * total_producidas / total_meta, 2),
        "liberadas_sin_retrabajo_pct_sobre_producidas": round(100 * total_primera / total_producidas, 2) if total_producidas else 0,
        "estados_previstos": {s: estados[s] for s in ESTADOS},
        "incidencias": dict(Counter(i["tipo"] for i in incidentes)),
    }
    assert sum(estados.values()) == total_producidas
    assert len({u["numero_serie"] for u in unidades}) == total_producidas
    return {"etapa": "PLANIFICACION_SIN_BD", "semilla": seed, "resumen": resumen,
            "turnos": turnos, "incidentes": incidentes, "unidades": unidades}


def guardar(resultado: dict, directorio: Path) -> None:
    directorio.mkdir(parents=True, exist_ok=True)
    (directorio / "escenario.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for nombre, filas in (("turnos.csv", resultado["turnos"]),
                          ("incidencias.csv", resultado["incidentes"]),
                          ("unidades.csv", resultado["unidades"])):
        if not filas:
            continue
        with (directorio / nombre).open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=filas[0].keys())
            writer.writeheader()
            writer.writerows(filas)


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulador NOVA SOUND: ETAPA 1, sin cambios en la base de datos")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--salida", type=Path, default=Path("resultados/simulacion"))
    parser.add_argument("--seed", type=int)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    resultado = simular(config, semilla=args.seed)
    guardar(resultado, args.salida)
    print(json.dumps(resultado["resumen"], ensure_ascii=False, indent=2))
    print(f"Archivos: {args.salida.resolve()}")
    print("ETAPA 1: no se ha llamado a FastAPI ni se ha modificado PostgreSQL.")


if __name__ == "__main__":
    main()
