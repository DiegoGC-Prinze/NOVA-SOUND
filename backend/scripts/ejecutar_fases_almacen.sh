#!/usr/bin/env bash
# Fases 2–5 en una sola sesión. NUNCA hace git commit/push ni modifica nova_sounds.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$ROOT/backend"
PY="$BACKEND/.venv/bin/python"

if [[ "${1:-}" != '--ejecutar' && "${1:-}" != '--reanudar' ]]; then
  cat <<'EOF'
Uso: bash backend/scripts/ejecutar_fases_almacen.sh --ejecutar [unidades-por-orden]
     bash backend/scripts/ejecutar_fases_almacen.sh --reanudar RUN_ID
La ejecución es ADITIVA en nova_sounds_test; genera 8 órdenes, 8 lotes y
por defecto 320 unidades sintéticas. NO borra ni reinicia la base.
Sin --ejecutar no se insertan datos.
EOF
  exit 2
fi
N="${2:-40}"
if [[ "${1:-}" == '--reanudar' ]]; then
  RUN_RESUME="${2:-}"
  if ! [[ "$RUN_RESUME" =~ ^[A-Fa-f0-9]{10}$ ]] || (( $# != 2 )); then
    echo 'Uso para reanudar: --reanudar RUN_ID (10 hex)' >&2
    exit 2
  fi
  SIM_ARGS=(--ejecutar --flujo --reanudar "$RUN_RESUME")
else
  if ! [[ "$N" =~ ^[0-9]+$ ]] || (( N < 16 || N > 1000 )); then
    echo 'Unidades por orden: entero entre 16 y 1000' >&2
    exit 2
  fi
  SIM_ARGS=(--por-orden "$N" --ejecutar --flujo)
fi
[[ -x "$PY" ]] || { echo "Falta Python venv: $PY" >&2; exit 2; }
command -v node >/dev/null || { echo 'No está instalado node para las pruebas del adaptador Frontend' >&2; exit 2; }
mkdir -p "$ROOT/docs/evidencias"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

printf '\n===== FASE 2: SIMULACIÓN SOLO EN _test =====\n'
"$PY" "$BACKEND/scripts/simular_almacen_test.py" "${SIM_ARGS[@]}" | tee "$LOG"
RUN_ID="$(sed -n 's/^SIMULACIÓN GENERADA\. RUN_ID=\([A-F0-9]\{10\}\)$/\1/p' "$LOG" | tail -1)"
if [[ -z "$RUN_ID" ]]; then
  echo 'No se pudo identificar RUN_ID en salida del simulador; revisar evidencia' >&2
  exit 1
fi
printf '\n===== FASE 3: TRAZABILIDAD %s =====\n' "$RUN_ID"
"$PY" "$BACKEND/scripts/verificar_trazabilidad_simulacion.py" --run-id "$RUN_ID"

printf '\n===== FASE 4: CONTRATOS DEL CLIENTE FRONTEND =====\n'
node --test "$ROOT/frontend/integraciones/almacenApi.test.mjs"

printf '\n===== FASE 5: 22 PRUEBAS Y REVISIÓN GIT =====\n'
(
  cd "$BACKEND"
  ALMACEN_RUN_INTEGRATION=1 "$PY" -m pytest -q --tb=short \
    tests/test_almacen.py tests/test_almacen_integracion.py \
    --junitxml="$ROOT/docs/evidencias/almacen_pytest.xml"
)
(
  cd "$ROOT"
  echo "Rama: $(git branch --show-current)"
  git diff --check
  git status --short
)
printf '\nLISTO: Fases 2 y 3 auditadas; cliente JS probado; pruebas de Backend validadas.\n'
printf 'RUN_ID=%s\n' "$RUN_ID"
printf 'NOTA: integración visual y push a GitHub requieren revisión con equipo.\n'
