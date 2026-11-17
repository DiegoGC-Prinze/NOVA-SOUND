# Ejecutar todas las pruebas

Desde la raíz del repositorio, en PowerShell:

```powershell
python scripts/probar_todo.py
```

Requisitos: Python 3.10 o superior, Node.js 22 o superior, Docker Desktop iniciado con contenedores Linux y Edge/Chrome instalado. No es necesario instalar pytest o librerías Python en Windows: el backend se prueba dentro de Docker.

Si el navegador está en otra ubicación, define `NOVA_TEST_BROWSER` con la ruta de su ejecutable antes de iniciar.

## Qué ejecuta

| Suite | Cobertura |
|---|---|
| `almacenApi.test.mjs` | Cliente HTTP y manejo de errores; 3 pruebas. |
| Pruebas Python de `backend/tests` | 69 pruebas: 29 de contratos/unidad y 40 de integración PostgreSQL. |
| `frontend.test.mjs` | 17 escenarios de demostración y carga de las 41 pantallas. |
| `almacen-real.test.mjs` | Las 13 pantallas de Almacén con dos cuentas reales, solicitudes y reaperturas, cajas y embarques persistidos. |
| `gestion-real.test.mjs` y `calidad-flujo.mjs` | Cuenta Sistemas creada al arrancar y alta de un usuario desde su formulario; 28 pantallas de Producción, Gerencia, Sistemas, Pruebas y Calidad y flujo completo hasta embarque. |
| Verificación SQL final | Confirma que la unidad y la caja quedaron EMBARCADA, el embarque ENVIADO y los datos de destino y contenedor se conservaron. |

Los números corresponden a las suites actuales y pueden aumentar al añadir pruebas.

## Aislamiento y resultados

El ejecutor genera un proyecto Docker con nombre `nova-test-...`, un puerto libre distinto de 8000, credenciales aleatorias y un volumen nuevo. No usa el `.env` de la aplicación ni modifica sus contenedores o sus registros. Prepara automáticamente el esquema, los datos y las migraciones 04, 05, 06, 07 y 08; también crea las cuentas y unidades QA que necesita el navegador. Comprueba que la migración 07 se pueda repetir conservando permisos y catálogos editados, y verifica los resultados finales directamente en SQL.

Al terminar, incluso si una prueba falla, retira los contenedores y el volumen temporal que identifica como propios, y elimina los archivos de credenciales QA. Conserva un `resultado.json` y un registro de ejecución en una carpeta temporal cuya ruta aparece en la terminal. Las pruebas del navegador también muestran sus propias carpetas de evidencia.

El comando devuelve código `0` si todo pasa y código `1` cuando falla una suite o su preparación. En PowerShell puedes consultar el resultado con `$LASTEXITCODE`. No hay una duración fija: depende de la descarga de imágenes y paquetes y del navegador.

## Ejecutar solamente una parte

Cliente HTTP:

```powershell
node --test frontend/integraciones/almacenApi.test.mjs
```

Frontend de demostración:

```powershell
node frontend/tests/frontend.test.mjs
```

Backend sin base real:

```powershell
docker build --target test -f backend/Dockerfile -t nova-sound-tests .
docker run --rm nova-sound-tests
```

Este último comando da actualmente **29 aprobadas y 40 omitidas**: esas 40 requieren PostgreSQL y se incluyen al usar el ejecutor completo. El script `backend/scripts/simular_almacen_test.py` es una herramienta manual de simulación, no una suite de pytest; el recorrido completo automatizado ya se valida con el ejecutor.
