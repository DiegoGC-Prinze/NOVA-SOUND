# NOVA SOUND — Simulacion industrial con historia real en PostgreSQL

**Rama exclusiva:** `feature/simulacion-industrial`. NO fusionar con `main` antes de revisar las pruebas.
**Caso académico:** 30 dias operativos, 3 lineas, 2 turnos, 4 modelos. Por velocidad, la meta se **escala** (15 por linea/turno por defecto), pero las tasas e incidencias varian y los estados son reales.

Este paquete es una **extension de la Etapa 1** ya validada. Incluye el generador `simular.py` para compatibilidad. Implementa un segundo entorno Docker separado del que corre en el puerto `8000`. No modifica sus contenedores ni su volumen.

## Arquitectura

- `scripts/simulacion/aplicar.py`: genera escenarios y ejecuta **HTTP real** con Python sin SQL.
- `cliente_api.py`: autenticacion Bearer con cuentas de Sistemas, Operador, Lider de linea, Inspector de Calidad y Almacen.
- API **normal**: `gestion/operacion` -> `pruebas/resultado` -> `calidad/.../inspeccion` -> `almacen/.../cajas` -> `almacen/.../embarques`.
- API **exclusiva** `simulacion/` (en `backend/app/modules/simulacion/router.py`): prepara ordenes, fija objetivos por fecha y **consolida fechas** de registros creados con las reglas reales. La operacion SQL queda encapsulada dentro del Backend; el simulador nunca ejecuta SQL por su cuenta.
- Se conservan estados, validaciones, permisos de roles y auditorias de la API existente.
- `compose.simulacion.yaml`: solo en `127.0.0.1:8001`, PostgreSQL en red interna y volumen propio al usar `-p nova-sound-simulacion`.
- `NOVA_SIMULATION_MODE=1`, clave `X-Simulation-Key` y rol Sistemas son obligatorios para endpoints extraordinarios. El programa se niega a conectarse al puerto 8000.

## 1. Preparacion en Fedora 44

Trabaja en **tu clon de pruebas**, con la rama indicada:

```bash
cd ~/Proyectos/NOVA-SOUND-PRUEBAS
git status -sb
# Debe mostrar ## feature/simulacion-industrial
```

Descomprime el ZIP del paquete en la **raiz** (verifica la ruta al ZIP; no se incluyo `.env`):

```bash
unzip -o ~/Descargas/NOVA_SOUND_SIMULACION_COMPLETA.zip -d .
python3 scripts/simulacion/instalar.py
python3 scripts/simulacion/crear_entorno.py
```

`instalar.py` solo inserta el router antes del frontend en `backend/app/main.py` **si la rama activa es la esperada**, e ignora resultados en Git. `crear_entorno.py` genera `.env.simulacion` con contrasenas aleatorias; no sobrescribe credenciales anteriores. **No compartas el archivo**.

## 2. Levantar SOLO el entorno aislado

El proyecto de prueba actual en 8000 **se queda encendido**. Desde la raiz:

```bash
docker compose -p nova-sound-simulacion --env-file .env.simulacion -f compose.yaml -f compose.simulacion.yaml config --quiet

docker compose -p nova-sound-simulacion --env-file .env.simulacion -f compose.yaml -f compose.simulacion.yaml up -d --build --wait

docker compose -p nova-sound-simulacion --env-file .env.simulacion -f compose.yaml -f compose.simulacion.yaml ps
curl -fsS http://127.0.0.1:8001/api/v1/health
```

Si algo falla:

```bash
docker compose -p nova-sound-simulacion --env-file .env.simulacion -f compose.yaml -f compose.simulacion.yaml logs --tail 120 app db
```

No borres volúmenes con `down -v`. Para parar SIN borrar registros:

```bash
docker compose -p nova-sound-simulacion --env-file .env.simulacion -f compose.yaml -f compose.simulacion.yaml down
```

## 3. Generar el plan de 30 dias (SIN escribir BD)

```bash
python3 scripts/simulacion/aplicar.py --meta-turno 4 --seed 20261125
```

Este escenario ligero contiene tres lineas, dos turnos y **30 días desde 22-oct-2026 hasta 25-nov-2026**, fecha de la presentación. La fecha futura de un dia se permite **solo** en el volumen simulado para que los dashboards tengan datos con fecha 25-nov-2026. No son hechos reales: son datos sinteticos.

## 4. Carga por la API (SI escribe solo en Docker :8001)

Primero haz una prueba corta para detectar contratos no compatibles:

```bash
python3 scripts/simulacion/aplicar.py --meta-turno 4 --seed 1001 --max-unidades 30 --aplicar
```

**Importante:** esa prueba crea un lote parcial `SIM-1001`, por eso la prueba completa usara otra semilla. Luego, para cubrir **todos los 30 dias** con volumen manejable:

```bash
python3 scripts/simulacion/aplicar.py --meta-turno 4 --seed 20261125 --aplicar
```

Para mayor densidad (alrededor de 2,500 unidades de escenario, 30 días), en un lote **distinto**:

```bash
python3 scripts/simulacion/aplicar.py --meta-turno 15 --seed 20261124 --aplicar
```

**No** ejecutes dos procesos de carga simultaneamente. El script reporta cada linea/turno completado. Si interrumpes el script, guarda el error y el `run_id`; los turnos **completados** se saltan al repetir la misma semilla y configuración. Si se interrumpe en medio de un turno no consolidado, **no lo reintentes a ciegas**: puede haber datos parciales; utiliza una semilla nueva o revisa el lote antes.

## 5. Validacion

```bash
python3 -m unittest discover -s tests -p 'test_simulacion*.py' -v

# Swagger real
# http://127.0.0.1:8001/docs
# Frontend real
# http://127.0.0.1:8001
```

- Entra con `SISTEMAS_USUARIO` y `SISTEMAS_PASSWORD` de `.env.simulacion` para gestionar usuarios. Los perfiles de operacion creados por el script tienen prefijo `sim_` y contrasenas guardadas SOLO en `.env.simulacion`.
- `resultados/simulacion_<seed>/escenario.json` muestra el PLAN; `resumen_bd.json` contiene el ESTADO REAL despues de aplicar la API.
- En **Gerencia / cierres** consulta los dias historicos. En **Calidad / reportes**, elige 22-oct-2026 al 25-nov-2026. En Empaque y Embarques consulta cajas/embarques. Por serie `SIM-<seed>-000001` consulta trazabilidad.
- Los paneles de produccion que filtran **hoy** tendran datos del ultimo dia de simulacion cuando el reloj real sea 25-nov-2026. Una consulta antes de esa fecha debe usar filtros historicos.
- Los porcentajes y la escala de produccion se basan en **hipotesis**. El caso docente describe alrededor de 3,500–4,500 unidades/dia; esta version opera **a escala** para demostrar validaciones y trazabilidad sin cientos de miles de solicitudes HTTP.

## 6. Cambios en Git (solo tu rama)

```bash
git status -sb
git add .gitignore backend/app/main.py backend/app/modules/simulacion/ compose.simulacion.yaml scripts/simulacion/ tests/test_simulacion_integracion.py README_SIMULACION_COMPLETA.md
git diff --cached --stat
git commit -m 'feat: simulacion industrial historica aislada por API'
git push -u origin feature/simulacion-industrial
```

No se agregan `.env.simulacion` ni `resultados/`. Ninguno de estos pasos fusiona la rama con `main`.

## LIMITACIONES REALES

- El codigo y las 9 pruebas locales Python se verificaron sin PostgreSQL ni Docker. **No afirmamos que el flujo completo haya pasado de punta a punta** hasta ejecutar `--aplicar` en tu Fedora. Si surge HTTP 409/422/500, necesitamos ver el mensaje y los logs, sin contrasenas.
- La consolidacion simula la fecha histórica de datos operativos **ya aceptados** por la API. No altera el reloj real del servidor ni las expiraciones de sesiones y no reescribe estados manualmente.
- Si generas nuevos datos en la base original de puerto 8000, son independientes; no se importan automaticamente.
