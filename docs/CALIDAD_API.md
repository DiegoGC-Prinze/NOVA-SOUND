# Módulo de Calidad - NOVA SOUND API

Este módulo gestiona la inspección, liberación, retención, retrabajo y scrap de las unidades, garantizando la trazabilidad completa en el piso de producción.

## Seguridad y Permisos
Todos los endpoints requieren `Authorization: Bearer <token>` de `/api/v1/auth/login`. Los permisos se consultan en PostgreSQL en cada petición y no dependen de IDs fijos de rol. El inspector se toma de la sesión; enviar otro `id_usuario` se rechaza. Consulta [la guía integrada](CONEXION-CALIDAD-PRUEBAS.md).

## Endpoints Principales

### 1. Resumen de Calidad (Dashboard)
- **Ruta:** `GET /api/v1/calidad/resumen`
- **Descripción:** Retorna el conteo en tiempo real de unidades Liberadas, en Retención, en Retrabajo y Scrap para alimentar las gráficas del dashboard.

### 2. Búsqueda de Unidad por Escáner
- **Ruta:** `GET /api/v1/calidad/unidades/{numero_serie}`
- **Descripción:** Busca los detalles de una unidad específica. Lanza un 404 si la unidad no existe.

### 3. Catálogo de Defectos
- **Ruta:** `GET /api/v1/calidad/defectos`
- **Descripción:** Lista todas las categorías de defectos disponibles (Falla Funcional, Estética, etc.) para poblar los selectores del frontend.

### 4. Registrar Inspección
- **Ruta:** `POST /api/v1/calidad/inspeccion`
- **Cuerpo compatible (JSON):** `numero_serie`, `estado`, `id_categoria_defecto`, `defecto` y `causa`. `id_usuario` es opcional y, si se envía, debe coincidir con la sesión.
- **Descripción:** Ejecuta una transacción que actualiza el estado de la unidad e inserta el evento en el historial de calidad. Valida reglas de negocio estables.

### 5. Historial de Trazabilidad
- **Ruta:** `GET /api/v1/calidad/trazabilidad/{numero_serie}`
- **Descripción:** Devuelve la línea de tiempo cronológica completa de una unidad, indicando qué inspector hizo el cambio, en qué fecha y el motivo exacto de la falla (si aplica).

## Contrato de las pantallas integradas

- `GET /api/v1/calidad/catalogos`: categorías y defectos con sus códigos y estados.
- `POST /api/v1/calidad/unidades/{serie}/inspeccion`: `{disposicion, defectos: [{categoria, defecto, causa}], observaciones}`.
- `GET /api/v1/calidad/retenciones` y `POST /api/v1/calidad/unidades/{serie}/retencion/resolver`.
- `GET /api/v1/calidad/retrabajos` y `POST /api/v1/calidad/unidades/{serie}/retrabajo`.
- `GET /api/v1/calidad/reportes`: filtros `desde`, `hasta`, `turno`, `linea` y `modelo`.
- `GET /api/v1/pruebas/operacion`: unidades por probar y su historial real.
- `POST /api/v1/pruebas/resultado`: `{serie, prueba: {encendido, audio, carga, bluetooth}, observaciones}`; cada resultado es `Aprobada` o `Falla`.

La inspección requiere una prueba funcional aprobada y estado `PROBADA`. Las escrituras bloquean la unidad y rechazan cambios incompatibles con su estado. Retenciones y retrabajos guardan responsable, observaciones y fecha. `SCRAP`, `EMPACADA` y `EMBARCADA` impiden nuevas pruebas o disposiciones.
