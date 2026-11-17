#!/usr/bin/env bash
# Crear base PostgreSQL APARTE para ejecutar los tests sin tocar nova_sounds.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="nova_sounds_test"
ROLE="nova_app"

if sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -qx 1; then
    echo "La base $DB YA EXISTE. No se borra ni reinicializa automaticamente." >&2
    echo "Usa esa base solo si verificaste que tiene el esquema/migraciones; no usar nova_sounds." >&2
    exit 2
fi

echo "Creando SOLO $DB, propiedad de $ROLE..."
sudo -u postgres createdb -O "$ROLE" "$DB"
read -r -s -p "Contraseña LOCAL de PostgreSQL para $ROLE: " PGPASSWORD
printf '\n'
export PGPASSWORD
trap 'unset PGPASSWORD' EXIT
for sql in \
  01_esquema_postgresql.sql \
  02_datos_postgresql.sql \
  04_modulo_almacen.sql \
  05_catalogo_modelos_oficiales.sql \
  06_integracion_frontend.sql \
  07_produccion_sistemas_gerencia.sql \
  08_calidad_pruebas.sql
do
    echo "Aplicando $sql SOLO en $DB ..."
    psql -h 127.0.0.1 -U "$ROLE" -d "$DB" -X -v ON_ERROR_STOP=1 \
      -f "$ROOT/database/postgresql/$sql" > /dev/null
done

echo "Base de PRUEBAS preparada. La base nova_sounds no fue modificada."
echo "Para correr: cd backend && ALMACEN_RUN_INTEGRATION=1 python -m pytest -q tests/test_almacen_integracion.py"
