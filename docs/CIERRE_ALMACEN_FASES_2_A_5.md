# NOVA SOUND — Cierre controlado de las fases 2 a 5

Fecha de referencia: 15 de noviembre de 2026.

## Estado de partida confirmado

- 16 pruebas unitarias/contrato y 6 de integración con PostgreSQL aprobadas (`22 passed in 2.23s`).
- `docs/evidencias/almacen_pytest.xml` se creó en el equipo del usuario.
- `nova_sounds` tiene migración aditiva 04; `nova_sounds_test` tiene esquema y 25 tablas.
- La autenticación real de producción, integración del Frontend y pruebas de carga de 30–50 operadores simultáneos **siguen pendientes**.

## Ejecución integral rápida

```bash
cd ~/Proyectos/NOVA-SOUND
bash backend/scripts/ejecutar_fases_almacen.sh --ejecutar
```

El lanzador se detiene ante errores y no ejecuta `git commit` ni `git push`.
Más abajo se describe cada fase para diagnosticar fallas individualmente.

## Fase 2: simulación sintética en base de pruebas

Ejecutar siempre desde `backend/`, con `.venv` activo y `backend/.env` con usuario/clave de `nova_app` (no subir el archivo):

```bash
python scripts/simular_almacen_test.py --por-orden 40
python scripts/simular_almacen_test.py --por-orden 40 --ejecutar --flujo
```

El simulador **solo escribe en `nova_sounds_test`** por defecto; valida sufijo `_test`, conexión y migraciones antes de ejecutar. El primer comando es una vista previa. El segundo genera 8 órdenes (4 modelos × 2 clientes: uno permite mezclar colores, otro no), 8 lotes, 320 unidades, pruebas funcionales y Calidad. Usa tres líneas, dos turnos, colores y estados `LIBERADA`, `EN_RETENCION`, `EN_RETRABAJO`, `SCRAP`. Luego ejecuta la API con actor de prueba: 16 cajas en total, 8 cerradas, 8 abiertas en proceso y 4 embarques enviados; registra bitácora. Por cada orden intenta agregar una serie bloqueada y verifica que el Backend rechace la operación.

Los totales del panel son globales, incluyen los datos semilla; los contadores de la corrida se identifican con series `SIM-<RUN_ID>-...`. Las nuevas corridas son **aditivas**, no eliminan resultados anteriores. Solo repetir si necesitas más escenarios.

El script imprime `RUN_ID=XXXXXXXXXX` y guarda `docs/evidencias/almacen_simulacion_XXXXXXXXXX.json` con IDs y series sintéticas. Si falla parcialmente después de crear los datos, se preserva el manifiesto para investigar sin borrar nada.

## Fase 3: auditoría de trazabilidad SQL + API

Usar el `RUN_ID` impreso por el paso anterior:

```bash
python scripts/verificar_trazabilidad_simulacion.py --run-id XXXXXXXXXX
```

Verifica: cantidad generada, 8 órdenes, 4 modelos, 3 líneas, 2 turnos, liberación vigente por Calidad, compatibilidad orden/cliente/modelo, capacidad, mezcla de colores, estados de cajas y embarques y secuencia de auditoría por unidad. Además consulta el endpoint real `/trazabilidad/{numero_serie}` para muestras.

Genera `docs/evidencias/almacen_trazabilidad_XXXXXXXXXX.json`. **Solo se considera aprobada esta fase si el comando finaliza sin errores y dice `TRAZABILIDAD VALIDADA`.**

## Fase 4: contrato para pantallas del Frontend

- Integración independiente en `frontend/integraciones/almacenApi.mjs`.
- Ejemplos en `frontend/integraciones/ejemplo_consumo.mjs`.
- Validaciones JavaScript: `node --test frontend/integraciones/almacenApi.test.mjs` desde la raíz.
- Matriz detallada en `docs/INTEGRACION_FRONTEND_ALMACEN.md`.

No sustituye las pantallas React/Vue/HTML que ya construye el equipo; el archivo se **importa** desde sus componentes cuando tengan su código consolidado. El nombre/ubicación de la carpeta `frontend` se puede ajustar según el árbol real.

## Fase 5: pruebas finales y preparación Git (NO hace push automático)

```bash
cd ~/Proyectos/NOVA-SOUND/backend
ALMACEN_RUN_INTEGRATION=1 python -m pytest -q --tb=short \
  tests/test_almacen.py tests/test_almacen_integracion.py \
  --junitxml=../docs/evidencias/almacen_pytest.xml
cd ..
node --test frontend/integraciones/almacenApi.test.mjs
git branch --show-current
git status --short
git diff --check
git diff -- backend/app/main.py
```

Confirmar `feature/almacen`. No publicar archivos `.env`, respaldos PostgreSQL (`*.dump`), ZIP de entregas, datos reales ni código de otros integrantes accidentalmente modificado. El archivo `backend/app/main.py` **debe revisarse** antes de incluirlo para que se conserve el registro de rutas de otros integrantes; este paquete no lo modifica.

Con la revisión hecha, preparar selectivamente los cambios propios:

```bash
git add backend/app/modules/almacen/ backend/tests/test_almacen.py backend/tests/test_almacen_integracion.py
git add backend/scripts/simular_almacen_test.py backend/scripts/verificar_trazabilidad_simulacion.py
git add database/postgresql/02_datos_postgresql.sql database/postgresql/04_modulo_almacen.sql database/postgresql/05_catalogo_modelos_oficiales.sql
git add docs/ALMACEN_API.md docs/CONTRATOS_FRONTEND_EMPAQUE.md docs/PLAN_PRUEBAS_ALMACEN.md
git add docs/INTEGRACION_FRONTEND_ALMACEN.md docs/CIERRE_ALMACEN_FASES_2_A_5.md
git add frontend/integraciones/almacenApi.mjs frontend/integraciones/ejemplo_consumo.mjs frontend/integraciones/almacenApi.test.mjs
git add docs/evidencias/almacen_pytest.xml
# Opcional, tras revisar datos: git add docs/evidencias/almacen_simulacion_*.json docs/evidencias/almacen_trazabilidad_*.json
# Solo si main.py contiene únicamente el cambio acordado al registrar el router:
# git add backend/app/main.py

git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
```

**Solo si la lista de archivos y pruebas es correcta**, ejecutar manualmente:

```bash
git commit -m "Validate warehouse flows, traceability and frontend API contract"
git push -u origin feature/almacen
```

No ejecutar `git add .` sin revisar: podrían incluirse archivos de entregas o ajustes de otros integrantes. No fusionar a `main` sin coordinación.

## Qué falta para llamar terminada la integración general

- Integrar `almacenApi.mjs` en componentes reales con quien los desarrolle.
- Completar middleware de autenticación/sesión de Carlos y CORS/proxy.
- Hacer prueba de aceptación en navegador y roles; el diseño de filtro por turno necesita definición de contrato.
- Probar carga de 30–50 usuarios concurrentes, no solamente el conflicto de dos operaciones.
