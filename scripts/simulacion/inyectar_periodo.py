#!/usr/bin/env python3
"""Genera un periodo completo de NOVA SOUND en una base PostgreSQL de reemplazo."""
import argparse
import csv
import json
import random
import re
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = Path(__file__).with_name("inyectar_periodo.sql")
ORIGEN = "nova_sounds_simulacion"
REFERENCIAS = (
    "roles", "usuarios", "clientes", "modelos", "colores", "linea", "turnos",
    "areas", "cat_defectos", "catalogos_web", "configuracion_web",
)
ESTADOS = ("ENSAMBLADA", "FALLA_FUNCIONAL", "PROBADA", "EN_RETENCION", "RETRABAJO", "SCRAP", "LIBERADA")
PESOS = (1, 4, 2, 3, 3, 2, 85)
COMPOSE = [
    "docker", "compose", "-p", "nova-sound-simulacion", "--env-file", ".env.simulacion",
    "-f", "compose.yaml", "-f", "compose.simulacion.yaml", "exec", "-T", "db",
]


def ejecutar(programa, *args, **kwargs):
    """Usa el usuario de PostgreSQL del contenedor sin exponer credenciales."""
    comando = COMPOSE + [
        "sh", "-ec", 'programa=$1; shift; exec "$programa" -U "$POSTGRES_USER" "$@"',
        "sh", programa, *args,
    ]
    return subprocess.run(comando, cwd=RAIZ, check=True, **kwargs)


def planificar(desde, hasta, minimo, maximo, rng):
    plan = []
    for i in range((hasta - desde).days + 1):
        dia = desde + timedelta(days=i)
        total = rng.randint(minimo, maximo)
        primero = round(total * rng.uniform(0.47, 0.53))
        plan.append((dia, primero, total - primero))
    return plan


def copiar_esquema(destino):
    for opciones in (
        ["--schema-only"],
        ["--data-only", *[f"--table=public.{tabla}" for tabla in REFERENCIAS]],
    ):
        with tempfile.TemporaryFile() as dump:
            ejecutar("pg_dump", "--no-owner", "--no-privileges", *opciones, ORIGEN, stdout=dump)
            if "--schema-only" in opciones:
                dump.seek(0)
                ddl = dump.read().replace(b"CREATE SCHEMA public;", b"CREATE SCHEMA IF NOT EXISTS public;")
                dump.seek(0)
                dump.write(ddl)
                dump.truncate()
            dump.seek(0)
            ejecutar("psql", "-Xq", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-d", destino, stdin=dump)


def cargar(destino, plan, rng):
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", newline="") as archivo:
        archivo.write("""
BEGIN;
-- Validar el identificador antes de insertar en cualquier tabla.
CREATE TEMP TABLE unidades_plan (id_unidad int, fecha date, turno int, linea_pos int,
    modelo_pos int, minuto int, estado text, empacar boolean, falla int);
COPY unidades_plan FROM STDIN WITH (FORMAT csv);
""")
        writer = csv.writer(archivo, lineterminator="\n")
        numero = 0
        for dia, primero, segundo in plan:
            for turno, total in enumerate((primero, segundo), 1):
                for _ in range(total):
                    numero += 1
                    estado = rng.choices(ESTADOS, PESOS)[0]
                    writer.writerow((numero, dia, turno, rng.randrange(3), rng.randrange(4),
                                     rng.randrange(360), estado, estado == "LIBERADA" and rng.random() < 0.87,
                                     rng.randrange(4)))
        archivo.write("\\.\n")
        archivo.write(SQL.read_text(encoding="utf-8"))
        archivo.seek(0)
        ejecutar("psql", "-Xq", "-v", "ON_ERROR_STOP=1", "-d", destino, stdin=archivo)


def main(argv=None):
    global COMPOSE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--desde", type=date.fromisoformat, default=date(2026, 10, 25))
    parser.add_argument("--hasta", type=date.fromisoformat, default=date(2026, 11, 25))
    parser.add_argument("--min-diario", type=int, default=3500)
    parser.add_argument("--max-diario", type=int, default=4500)
    parser.add_argument("--seed", type=int, default=20261125)
    parser.add_argument("--base", default="nova_octnov_simulacion", help="Nombre nuevo para la base de reemplazo.")
    parser.add_argument("--proyecto", default="nova-sound-simulacion", help="Proyecto Docker del entorno de simulacion.")
    parser.add_argument("--env-file", type=Path, default=RAIZ / ".env.simulacion", help="Credenciales del entorno de simulacion.")
    parser.add_argument("--aplicar", action="store_true", help="Crea y carga una base nueva en Docker.")
    args = parser.parse_args(argv)
    if not 20 <= args.min_diario <= args.max_diario:
        parser.error("se requiere 20 <= --min-diario <= --max-diario")
    if args.hasta < args.desde:
        parser.error("--hasta debe ser igual o posterior a --desde")
    if not re.fullmatch(r"nova_[a-z0-9_]{1,45}_simulacion", args.base) or args.base == ORIGEN:
        parser.error("--base debe ser una base de simulación nueva y distinta del origen")
    rng = random.Random(args.seed)
    plan = planificar(args.desde, args.hasta, args.min_diario, args.max_diario, rng)
    print(json.dumps([{"fecha": str(dia), "turno_1": t1, "turno_2": t2, "total": t1 + t2}
                      for dia, t1, t2 in plan], indent=2), flush=True)
    print(f"Total: {sum(t1 + t2 for _, t1, t2 in plan):,} unidades en {len(plan)} días.", flush=True)
    if args.aplicar:
        if not args.env_file.is_file():
            parser.error("no existe el archivo de configuracion del entorno de simulacion")
        COMPOSE = ["docker", "compose", "-p", args.proyecto, "--env-file", str(args.env_file.resolve()),
                   "-f", str(RAIZ / "compose.yaml"), "-f", str(RAIZ / "compose.simulacion.yaml"), "exec", "-T", "db"]
        ejecutar("createdb", args.base)
        copiar_esquema(args.base)
        cargar(args.base, plan, rng)
        print(f"Base nueva validada: {args.base}. La app sigue apuntando a su base anterior hasta el cambio de conexión.")


if __name__ == "__main__":
    main()
