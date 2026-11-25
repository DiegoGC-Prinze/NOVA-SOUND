# NOVA SOUND — Corrección del reloj de simulación (V2)

**Problema corregido:** la API normal de Producción calcula la jornada con `CURRENT_DATE`, aunque los turnos se estén consolidando en fechas históricas. Después de consolidar 174 turnos, el 25/11/2026 colisiona con el cierre de la fecha real y devuelve HTTP 409.

**Qué hace este parche**

- Agrega `X-Simulation-Date` como fecha operativa a las rutas `/api/v1/gestion/operacion...`, bajo validación de `X-Simulation-Key` y solo en Docker con `NOVA_SIMULATION_MODE=1` y una base `*_simulacion`.
- Usa esa fecha operativa al comprobar bloqueos de Producción, registrar ensambles/unidades y crear cierres de turno. El resto del Backend sigue con el reloj habitual.
- La fecha se incorpora automáticamente desde `scripts/simulacion/aplicar.py` al cliente HTTP, sin alterar el sistema operativo ni modificar directamente PostgreSQL desde el generador.
- **Conserva** las 174 combinaciones de fecha/línea/turno consolidadas. La carga reanudada usa el mismo `run_id` y omite las ya completadas.
- Valida la rama `feature/simulacion-industrial`, exige patrones de código exactos, hace copia de seguridad en `resultados/respaldo_reloj_v2/` y comprueba la sintaxis de los archivos antes de escribirlos.

## Instalación en Fedora 44

Poner `NOVA_SOUND_FIX_RELOJ_V2.zip` en la raíz de `~/Proyectos/NOVA-SOUND-PRUEBAS`. Desde Konsole:

```bash
cd ~/Proyectos/NOVA-SOUND-PRUEBAS
git status -sb
unzip -n NOVA_SOUND_FIX_RELOJ_V2.zip -d .
python3 scripts/simulacion/reparar_reloj.py
python3 -m py_compile backend/app/main.py backend/app/modules/gestion.py scripts/simulacion/{aplicar,cliente_api}.py
```

**No se reinicia ni elimina PostgreSQL.** Recompilar únicamente el servicio `app` del **proyecto de presentación**:

```bash
docker compose -p nova-sound-presentacion --env-file .env.simulacion \
  -f compose.yaml -f compose.simulacion.yaml up -d --build --no-deps --wait app

docker compose -p nova-sound-presentacion --env-file .env.simulacion \
  -f compose.yaml -f compose.simulacion.yaml ps
```

Reanudar **exactamente el mismo `run_id`** con la misma semilla:

```bash
set -o pipefail
python3 scripts/simulacion/aplicar.py --meta-turno 4 --seed 20261125 --aplicar \
  2>&1 | tee resultados/logs/reanudacion.log
```

La ejecución debe mostrar `[175/180]` hasta `[180/180]`, luego `turnos_consolidados: 180`, `total_unidades: 676` y `len(dias): 30`. Si los valores difieren, **no declarar validación aprobada**.

## Nota sobre operaciones parciales

Antes del 409 del turno 175, el script registró la meta de ese día y pudo registrar incidencias. `objetivos` es idempotente y las unidades no se registraron porque el bloqueo ocurrió en `registrarUnidad`, pero **las incidencias de ese turno podrían duplicarse en el reintento**. Conservar este dato en la documentación de QA; no se borran registros para ocultarlo. Para una presentación rigurosa de métricas de incidencias, consultar antes la bitácora y reconciliar los registros parciales mediante una acción específica autorizada. El resto del flujo de unidades y turnos será verificable.

## Restricciones de seguridad

No se activa fuera de `feature/simulacion-industrial`. El middleware acepta el reloj simulado solo con clave privada, en la instalación aislada de simulación y para operaciones de Producción. No utilizar en un servidor compartido, y nunca fusionar el parche de reloj en `main` sin evaluación de seguridad.
