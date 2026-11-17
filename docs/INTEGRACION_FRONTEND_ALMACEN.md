# NOVA SOUND — Integración Frontend con Backend de Almacén

**Base API:** `/api/v1/almacen` · **Swagger:** `http://127.0.0.1:8000/docs` · **OpenAPI:** `/openapi.json`.

Este documento se basa en `router.py`, `schemas.py` de Almacén v1.0 y en las pantallas Excalidraw del equipo: `Pantallas_Diego.excalidraw` (Empaque) y `Pantallas_Will.excalidraw` (Embarques). **La existencia de este adaptador no significa que se haya conectado al Frontend real**; no se dispone aquí de su árbol de código.

## Mapa por pantalla

| Pantalla Excalidraw | Endpoints | Nota para integrar |
|---|---|---|
| Panel Empaque (Diego) | `GET /panel`, `GET /cajas` | Los totales son globales; filtros en lista de cajas. Los valores de maqueta no deben codificarse. |
| Formar caja / Escanear | `GET /ordenes`, `GET /unidades-disponibles?id_orden=`, `POST /cajas`, `POST /cajas/{id}/unidades` | Seleccionar orden; el Backend obtiene cliente, modelo y capacidad. |
| Contenido y confirmación de cierre (Diego/Will) | `GET /cajas/{id}`, `POST /cajas/{id}/cerrar` | El Backend impide cerrar vacía, no liberada, incompatible o sobredimensionada. No existe endpoint de pre-validación. |
| Consultar caja / reapertura | `GET /cajas/{id}`, `GET /cajas/{id}/historial`, `POST /cajas/{id}/solicitudes-reapertura`, `POST /cajas/{id}/reabrir` | Motivo de 10–300 caracteres y autorización por supervisor **distinto** del solicitante. |
| Historial de cajas / filtros | `GET /cajas?estado=&id_cliente=&id_modelo=&id_orden=&desde=&hasta=` | Fecha `YYYY-MM-DD`, campos opcionales. |
| Armar embarque (Will) | `GET /embarques`, `POST /embarques`, `GET /cajas?estado=CERRADA`, `POST /embarques/{id}/cajas/{caja}` | Solo cajas CERRADAS y de **la misma orden** del embarque. Mostrar solo elegibles de esa orden. |
| Estado de embarque (Will) | `GET /embarques/{id}`, `POST /embarques/{id}/salida`, `DELETE /embarques/{id}/cajas/{caja}` | Antes de salida se puede retirar caja; después de ENVIADO no se modifica. |
| Reportes / incidencia | `GET /reportes/empaque?desde=&hasta=`, `GET /reportes/incidencias`, `POST /cajas/{id}/incidencias` | El filtro de turno sugerido en diseño todavía no es parte del contrato. |
| Buscar por número de serie | `GET /trazabilidad/{numero_serie}` | Retorna orden, modelo, cliente, línea, turno, estado Calidad, caja, embarque e historial auditado desde esta versión. |

Todos los paths de la tabla son **relativos a `/api/v1/almacen`**.

## Ejemplo de contrato JSON

**Formar caja:** `POST /api/v1/almacen/cajas`

```json
{"id_orden": 21}
```

**Escanear unidad:** `POST /api/v1/almacen/cajas/30/unidades`

```json
{"numero_serie": "SIM-XXXXXXXXXX-11-00001"}
```

**Crear embarque:** `POST /api/v1/almacen/embarques`

```json
{"id_orden": 21, "referencia": "GUIA-DEMO-001"}
```

**Autorizar reapertura:** `POST /api/v1/almacen/cajas/30/reabrir`

```json
{"id_autorizacion": 12}
```

Estos IDs son **ejemplos**, no registros existentes. Almacén determina `id_cliente` y `id_modelo` a partir de la orden; **no** enviar cliente, capacidad o modelo al crear caja.

**Campos más relevantes de respuesta:**

- `CajaDetalle`: `id_caja`, `id_orden`, `id_cliente`, `cliente`, `id_modelo`, `modelo`, `capacidad`, `estado`, `cantidad_unidades`, `unidades`, `fecha_creacion`, `fecha_cierre`, `id_embarque`.
- `UnidadDetalle`: `id_unidad`, `numero_serie`, `id_color`, `color`, `estado`, `estado_calidad`, `id_orden`, `id_caja`.
- `EmbarqueDetalle`: `id_embarque`, `id_orden`, `id_cliente`, `cliente`, `referencia`, `estado`, `fecha_salida`, `cantidad_cajas`, `cantidad_unidades`, `cajas`.
- `TrazabilidadUnidad`: además de datos de unidad, orden, cliente, modelo y envío, incluye `historial_almacen` con `accion`, `id_usuario`, `fecha_hora` y `detalle`.

## Uso del cliente JavaScript

Archivo listo para importar: `frontend/integraciones/almacenApi.mjs`.

```js
import { createAlmacenApi } from './integraciones/almacenApi.mjs';
const almacen = createAlmacenApi();
const ordenes = await almacen.ordenes();
const caja = await almacen.formarCaja(ordenes[0].id_orden);
const detalle = await almacen.agregarUnidad(caja.id_caja, 'NUMERO_DE_SERIE_REAL');
```

Cambiar el import según ubicación real. Los métodos están en `ejemplo_consumo.mjs`. Se proporciona un cliente ESM compatible con JavaScript moderno, sin imponer React, Vue o Vanilla JS.

## Autenticación, red y errores

La API devuelve `401` sin sesión; `403` sin rol, `404` para recursos no encontrados, `409` para reglas de negocio, `422` para validación de entrada y `503` si PostgreSQL falla. Presentar `detail` al operador sin asumir que toda respuesta exitosa es `201`.

El cliente utiliza `credentials: 'include'` para sesiones basadas en cookies. La autenticación de escritura **no está integrada completamente**: el módulo espera `request.state.usuario_id` del middleware de Carlos. `ALMACEN_DEV_MODE=1` solo debe utilizarse en una máquina local para pruebas y **nunca** en redes compartidas o producción.

Si el Frontend se sirve en otro puerto, configurar proxy `/api` hacia FastAPI o CORS de forma explícita en la aplicación central (coordinando con Carlos). No modificar `main.py` sin verificar antes los routers existentes.

## Prueba manual de aceptación del Frontend (pendiente)

1. Iniciar sesión con usuario de Almacén; una sesión inválida debe mostrar 401/403.
2. Seleccionar orden: visualizar `cliente`, `modelo`, `capacidad_caja`.
3. Buscar/leer serie `LIBERADA`, crear caja y escanear; el contador debe coincidir con `cantidad_unidades`.
4. Intentar serie retenida, otra orden o exceder capacidad: mostrar el 409 sin agregar la unidad.
5. Cerrar caja y confirmar `estado=CERRADA`.
6. Crear embarque de la misma orden, agregar caja y registrar salida; mostrar `ENVIADO`.
7. Buscar serie embarcada, comprobar `id_orden`, `id_caja`, `id_embarque` e historial.
8. Volver al panel y refrescar contadores desde la API, sin números de maqueta.

**Pendiente de validar:** código Frontend definitivo, sesiones/roles, CORS/proxy, pantallas de turno, diseño visual y pruebas en navegador. Se recomienda primero integrar en rama individual y después revisar con quienes desarrollaron esas pantallas.
