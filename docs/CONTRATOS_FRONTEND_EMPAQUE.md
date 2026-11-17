# NOVA SOUND · Mapeo de pantallas de Empaque a endpoints

Referencia: pantallas de Empaque del archivo Excalidraw compartido por el equipo. Esta matriz ayuda a Jesús/Erick a conectar Frontend sin inventar contratos.

| Pantalla | Datos del diseño | API disponible | Estado |
|---|---|---|---|
| 1. Panel de Empaque | Cajas cerradas, cajas en proceso, pendientes y tabla de cajas | `GET /panel` + `GET /cajas` | Implementado, integración pendiente |
| 2. Formar caja | Orden, cliente, modelo, capacidad, búsqueda/escaneo y lista de unidades | `GET /ordenes`, `POST /cajas`, `GET /unidades-disponibles`, `POST /cajas/{id}/unidades` | Implementado |
| 3. Confirmar cierre | Resumen de caja, unidades, modelo, capacidad y validaciones | `GET /cajas/{id}` + `POST /cajas/{id}/cerrar` | Validación del lado servidor; falta endpoint específico de vista previa de checks si Frontend lo requiere |
| 4. Consultar caja | Buscar por ID, mostrar contenido y estado, reapertura autorizada | `GET /cajas/{id}`, `GET /cajas/{id}/historial`, `POST /cajas/{id}/solicitudes-reapertura`, `POST /cajas/{id}/reabrir` | Implementado |
| 5. Historial de cajas | Filtros ID, cliente, modelo, estado y fechas | `GET /cajas` con query params | Implementado |
| 6. Reportes Empaque | Periodo, turno, totales e incidencias | `GET /reportes/empaque` + `GET /reportes/incidencias` | Periodo implementado; filtro de turno pendiente de regla funcional definitiva |

## Embarques

El mismo Backend ofrece `GET/POST /embarques`, detalle, auditoría, asignación y retiro de cajas, así como `POST /embarques/{id}/salida`. Debe revisarse su correspondencia **campo por campo** con las pantallas definitivas de Embarques del equipo. No se considera integrada únicamente por existir endpoints.

## Contrato de autenticación pendiente

La API de escritura necesita sesión validada por Carlos (`request.state.usuario_id`). Antes de desplegar a la red de planta, desactivar `ALMACEN_DEV_MODE` y verificar roles y CORS según los puertos reales del Frontend.
