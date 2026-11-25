#!/bin/sh
set -eu

pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" /respaldo/nova_sound_equipo.pgdump
