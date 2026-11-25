#!/bin/sh
set -eu

pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" /respaldo/nova_sound_equipo.pgdump

# Carga las estadísticas de planificación que pg_dump no incluye.
vacuumdb --analyze-in-stages -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"
