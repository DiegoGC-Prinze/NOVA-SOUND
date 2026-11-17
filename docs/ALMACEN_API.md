# NOVA SOUND · Backend de Empaque y Embarques v1.0

**Base tecnológica:** FastAPI · SQLAlchemy · PostgreSQL · Pydantic · Swagger/OpenAPI
**Rama de trabajo:** `feature/almacen`
**Estado:** código preparado; pruebas PostgreSQL aún pendientes en el entorno Fedora del equipo.

## Objetivo y límites del módulo

Proporcionar dos flujos sobre los registros compartidos de NOVA SOUND:

**Empaque**: orden → caja → unidad liberada → validación → cierre → posible reapertura autorizada.
**Embarques**: orden → embarque → caja cerrada → nueva verificación → salida registrada.

El módulo **NO** produce unidades, aprueba Calidad ni sustituye la autenticación de Carlos. Lee `ordenes`, `lote`, `calidad` y demás catálogos, y escribe sus propios cambios en `cajas`, `embarques`, `unidades` (estado/asociación) y `bitacora_general`.

## Catálogo oficial

| Código | Máximo unidades/caja |
|---|---:|
| NS-MINI | 12 |
| NS-SPORT | 8 |
| NS-PRO | 6 |
| NS-MAX | 4 |

`Modelo SoundPro X` no es admitido. La migración `05_catalogo_modelos_oficiales.sql` lo renombra a NS-MINI en la **base de demostración original**, sin cambiar el ID. Se aborta ante duplicados o modelos desconocidos para no eliminar relaciones de otras áreas. El archivo de seed `02_datos_postgresql.sql` ya utiliza los cuatro modelos.

## Persistencia y migraciones

- `04_modulo_almacen.sql`: añade a `cajas` las columnas `id_orden`, `capacidad`, `fecha_creacion`, `fecha_cierre`, sus restricciones/índices, sin borrar datos.
- `05_catalogo_modelos_oficiales.sql`: normaliza el catálogo oficial; no reasigna órdenes a modelos diferentes arbitrariamente salvo el único dato heredado de demostración explícito.
- `bitacora_general`: ya existía; ahora se usa **también** con `tabla_afectada='unidades'`, `id_registro_afectado=id_unidad` para registrar eventos de Almacén por unidad. Los detalles tienen formato JSON en `valor_nuevo` (varchar 500). Conservar siempre la relación estable `id_unidad`.

## Matriz de operaciones HTTP

Prefijo de todas las rutas: `/api/v1/almacen`

| Área | Método | Ruta | Acción |
|---|---|---|---|
| Panel | GET | `/panel` | Contadores actuales |
| Empaque | GET | `/ordenes` | Órdenes con capacidad |
| Empaque | GET | `/unidades-disponibles` | Búsqueda por orden y serie |
| Empaque | GET | `/cajas` | Listado con filtros |
| Empaque | POST | `/cajas` | Crear caja a partir de orden |
| Empaque | GET | `/cajas/{id_caja}` | Contenido y estado |
| Empaque | POST | `/cajas/{id_caja}/unidades` | Agregar unidad liberada |
| Empaque | DELETE | `/cajas/{id_caja}/unidades/{id_unidad}` | Retirar de caja abierta |
| Empaque | POST | `/cajas/{id_caja}/cerrar` | Validar y cerrar |
| Empaque | GET | `/cajas/{id_caja}/historial` | Historial por caja |
| Empaque | POST | `/cajas/{id_caja}/solicitudes-reapertura` | Solicitar reapertura |
| Empaque | GET | `/cajas/{id_caja}/solicitudes-reapertura` | Consultar solicitudes |
| Empaque | POST | `/cajas/{id_caja}/reabrir` | Autorizar reapertura |
| Empaque | POST | `/cajas/{id_caja}/incidencias` | Registrar incidencia |
| Embarques | GET | `/embarques` | Listar |
| Embarques | POST | `/embarques` | Crear |
| Embarques | GET | `/embarques/{id_embarque}` | Detalle de cajas |
| Embarques | GET | `/embarques/{id_embarque}/historial` | Auditoría del embarque |
| Embarques | POST | `/embarques/{id_embarque}/cajas/{id_caja}` | Asignar caja cerrada |
| Embarques | DELETE | `/embarques/{id_embarque}/cajas/{id_caja}` | Quitar caja antes de salida |
| Embarques | POST | `/embarques/{id_embarque}/salida` | Confirmar envío |
| Reportes | GET | `/reportes/empaque` | Resumen por fechas |
| Reportes | GET | `/reportes/incidencias` | Incidencias |
| Trazabilidad | GET | `/trazabilidad/{numero_serie}` | Situación actual e historia de Almacén |

## Reglas críticas

1. Solo unidad `LIBERADA` en `unidades` **y en la última inspección de Calidad** puede empacarse.
2. Una unidad solo puede pertenecer a una caja; la caja debe corresponder a la misma orden, modelo y cliente.
3. Capacidad máxima según modelo; no se pueden mezclar modelos. Mezclar colores requiere `clientes.mezcla_colores=TRUE`; cuando es `FALSE`, se obliga también al color de la orden.
4. La caja cerrada no se modifica; reapertura solo solicitada con motivo y autorizada por un supervisor o administrador **distinto**.
5. Embarque acepta cajas cerradas del cliente y la orden correctos; revalida Calidad antes de asignar y antes de registrar salida.
6. Las escrituras críticas son transaccionales y se auditan. Las validaciones de idempotencia y las restricciones de base se complementan; el equipo de Calidad debe coordinar cambios de estado simultáneos.

## Trazabilidad mejorada

`GET /trazabilidad/{numero_serie}` devuelve el estado actual y el nuevo campo:

```json
{
  "historial_almacen": [
    {
      "id_bitacora": 101,
      "id_usuario": 5,
      "accion": "AGREGAR_UNIDAD",
      "valor_anterior": "{\"estado\": \"LIBERADA\"}",
      "valor_nuevo": "{\"serie\": \"QA-EXAMPLE\", \"id_caja\": 7, \"id_embarque\": null, \"id_orden\": 3, \"estado_anterior\": \"LIBERADA\", \"estado_nuevo\": \"EMPACADA\"}",
      "motivo": null,
      "fecha_hora": "2026-11-15T08:00:00",
      "detalle": {"serie": "QA-EXAMPLE", "id_caja": 7, "id_embarque": null, "id_orden": 3, "estado_anterior": "LIBERADA", "estado_nuevo": "EMPACADA"}
    }
  ]
}
```

Ejemplo ilustrativo, no una salida observada en tu PostgreSQL. El evento utiliza el `id_unidad` inmutable. Aunque se retire de la caja y `unidades.id_caja` vuelva a `NULL`, el historial sigue vinculado a la unidad original. Se registran eventos `AGREGAR_UNIDAD`, `RETIRAR_UNIDAD`, `CERRAR_CAJA`, `REABRIR_CAJA`, `ASIGNAR_EMBARQUE`, `QUITAR_EMBARQUE` y `REGISTRAR_SALIDA` por unidad, además de eventos por caja y embarque.

**Límite:** Solo se conservan los eventos registrados **desde la versión 1.0**. Los registros del seed existentes antes de activar esta bitácora no contienen todos esos eventos; no se inventan trayectorias históricas. La historia funcional de Calidad y de Producción debe consultarse/integrarse desde sus módulos propios.

## Seguridad e integración con Frontend

Para operaciones de escritura el módulo necesita `request.state.usuario_id` proporcionado por el middleware autenticado de Carlos. Actualmente admite roles de Almacén, Empaque, Supervisor de Almacén y Administrador; no admite cuentas exclusivamente de Calidad/Producción. El seed antiguo solo tiene `Administrador`, `Operador` e `Inspector Calidad`, por lo que Carlos deberá incluir los roles pertinentes en su catálogo definitivo. Reapertura exige supervisor o administrador distinto al solicitante.

`ALMACEN_DEV_MODE=1` funciona solo en localhost/testclient para facilitar ensayos antes de integrar el login. **No usar fuera de demos locales.** Los endpoints GET de consulta aún son públicos dentro del servidor; el equipo debe definir y configurar permisos de lectura para el despliegue.

Frontend puede utilizar `/docs`, `/redoc`, `/openapi.json` para incorporar contratos sin depender de datos fijos. CORS puede requerir configuración en `main.py` si Frontend corre en otro origen; acordar puertos/URLs con Jesús y Erick.

## Pruebas automatizadas

- `backend/tests/test_almacen.py`: 16 pruebas unitarias/de contrato de FastAPI con datos simulados; no conectan con PostgreSQL real.
- `backend/tests/test_almacen_integracion.py`: 6 pruebas con base real `nova_sounds_test`: catálogo y capacidades, empaque→cierre→embarque→salida, historial tras retirar unidad, doble escaneo concurrente, autorización de reapertura y rechazo de cajas de otra orden. Crea datos de prueba variados y los elimina por sus IDs tras cada ejecución.
- Si `ALMACEN_RUN_INTEGRATION` no es `1`, las pruebas de integración se **omiten**; es protección deliberada, no aprobación.

El paquete se comprobó localmente con tests simulados; **no se ha ejecutado la suite de PostgreSQL real en la máquina del usuario**. Guardar logs, salida de pytest y respuestas Swagger para evidencias finales.

## Próximos puntos a validar

- Concurrencia con Calidad (especialmente actualización simultánea de `calidad` y empaque); acordar locks/transacciones con Aldair.
- Integración de autenticación y roles reales con Carlos.
- Revisión campo por campo de las pantallas Excalidraw y ajustes finales al contrato Frontend.
- Filtros específicos de reportes por turno/exportaciones, solo si el diseño final los exige.
- Caja heredada `LLENA`: no se considera cerrada hasta regularización manual supervisada.
