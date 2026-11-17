# Empaque y Embarques conectados a PostgreSQL

## Entrar al sistema

Abre **http://localhost:8000**, cierra cualquier sesión anterior y selecciona **Sistema conectado a PostgreSQL** en el login.

Usa el campo `usuario` de la tabla PostgreSQL `usuarios` y su contraseña. Si mantienes el seed original, existe `admin` con contraseña `pass123`. Si ya cambiaste esa cuenta, usa su contraseña vigente. Estas credenciales son distintas de `DB_USER` / `DB_PASSWORD` del `.env` y de las cuentas de demostración `4001` / `nova123`.

El Administrador de la aplicación puede realizar las operaciones de Almacén. Los roles `Almacén/Empaque` y `Supervisor de almacén` tienen permisos operativos diferentes. Las sesiones reales muestran **Datos de PostgreSQL** en las pantallas. El acceso **Demostración (incluye Pruebas y Calidad)** conserva los flujos locales; muestra **Datos de demostración en este navegador**.

La conexión no importa las cajas o unidades del almacenamiento local del navegador. Las órdenes y unidades disponibles se obtienen de PostgreSQL, con sus IDs numéricos y sus estados reales.

## Crear cuentas operativas

Desde la raíz del proyecto:

```powershell
docker compose exec app python -m app.crear_usuario_almacen --usuario almacen --nombre "Operador Almacen" --rol almacen
docker compose exec app python -m app.crear_usuario_almacen --usuario supervisor --nombre "Supervisor Almacen" --rol supervisor
```

Cada comando pide una contraseña de al menos ocho caracteres y su confirmación, sin mostrarla. No modifica cuentas existentes. El alta guarda un hash scrypt. Las claves antiguas del seed se convierten a este formato después de un login válido, conservando la misma contraseña para la persona.

## Recorrido real

1. Entrar con una cuenta de Almacén. En **Formar caja**, elegir una orden de PostgreSQL y crear una caja.
2. Agregar unidades que estén liberadas tanto en `unidades` como en su última inspección de Calidad. La API valida orden, modelo, cliente, colores y capacidad.
3. Recargar la pantalla o abrir **Consultar caja**. El contenido proviene de PostgreSQL. Los IDs ya no son los códigos `CX-...` de la demo.
4. Cerrar la caja. Si está incompleta, indicar un motivo de al menos diez caracteres. Se guarda el motivo en la bitácora.
5. Si hace falta reabrir: en **Consultar caja**, usar **Solicitar reapertura**. La caja sigue cerrada. Otra cuenta con permiso de supervisor entra, consulta esa caja y usa **Autorizar reapertura**. No se puede autorizar la solicitud propia ni reabrir una caja asignada a un embarque.
6. En **Armar embarque**, crear un envío para la misma orden, capturar destino y contenedor, y asignar las cajas cerradas. Antes de la salida se pueden retirar y reasignar cajas.
7. Confirmar la salida. La API vuelve a validar las cajas y unidades; cambia los estados y guarda fecha, destino, contenedor y eventos de auditoría en PostgreSQL.
8. Consultar **Estado del embarque**, **Paquetes en embarcación**, **Rastreo de contenedor**, **Historial de cajas** y los reportes. Recargar no elimina los cambios.

Las cajas heredadas del seed sin orden o capacidad no se transforman en cajas nuevas: pueden consultarse, pero requieren regularizar sus datos antes de operarlas. Para iniciar el recorrido utiliza **Crear caja**.

## Contratos y alcance

- Las 13 pantallas de Empaque/Embarques llaman al cliente `frontend/integraciones/almacenApi.mjs`, a través de `frontend/js/almacen-backend.js`.
- El adaptador convierte IDs, estados, cantidades, unidades, solicitudes e historial a los componentes visuales existentes. Los listados usan los conteos que retorna PostgreSQL; no inventan unidades para completar cantidades.
- La API autentica sesiones Bearer revocables, con ocho horas de vigencia. Solo el digest del token se guarda en `sesiones_web`. Cerrar sesión revoca el token; un token vencido o revocado impide escribir.
- El servidor comprueba el rol en las escrituras. Un supervisor no puede crear o formar cajas aunque invoque la API directamente.
- No hay retorno automático a datos de demostración cuando falla la API: el error se muestra o se exige iniciar sesión de nuevo.
- Las capacidades iniciales son MINI 12, SPORT 8, PRO 6 y MAX 4. Sistemas puede modificar los valores reales para cajas nuevas; las existentes conservan su capacidad. Los parámetros de la demo no cambian PostgreSQL.
- Producción, cierres, Gerencia y Sistemas también están conectados mediante la migración 07; consulta [su guía](CONEXION-GESTION.md). Pruebas funcionales y Calidad están conectadas mediante la migración 08 y [su guía](CONEXION-CALIDAD-PRUEBAS.md). La trazabilidad real se consulta en Gerencia o en `/api/v1/almacen/trazabilidad/{serie}`.

## Migración para una base existente

La migración `database/postgresql/06_integracion_frontend.sql` es aditiva y reejecutable. Añade sesiones, estado activo de usuarios, datos del embarque y los dos roles operativos. No crea cuentas con contraseñas predeterminadas ni borra registros.

Para nuevas instalaciones Docker la aplica automáticamente. Para una base que ya tiene volumen, primero conserva un respaldo y luego ejecuta:

```powershell
docker compose cp database/postgresql/06_integracion_frontend.sql db:/tmp/nova-06-integracion.sql
docker compose exec db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/nova-06-integracion.sql'
docker compose up -d --build --wait
```

No es necesario repetir el esquema ni el seed. No elimines el volumen para aplicar esta migración.

## Verificaciones

Se probaron en un Docker independiente:

- 34 pruebas del backend, incluidas 10 de integración PostgreSQL: autenticación real, hash de claves, token revocado o vencido, usuario inactivo, permisos de supervisor, cierre con motivo, reapertura por otra cuenta y persistencia del embarque.
- Las 13 pantallas con una cuenta real de Almacén en el navegador.
- Recorrido real desde el formulario hasta PostgreSQL: caja, rechazo de unidad retenida, unidad liberada, cierre, solicitud de reapertura, autorización con otro usuario, asignación, retiro y salida de embarque.
- Comprobación SQL posterior: unidad y caja `EMBARCADA`, embarque `ENVIADO`, destino y contenedor conservados.
- Cero escrituras de esas operaciones en el almacenamiento de mocks y peticiones HTTP reales observadas en el navegador.
- 17 escenarios de demostración, incluidas las 41 pantallas, para conservar el funcionamiento de las demás áreas.

El script `frontend/tests/almacen-real.test.mjs` utiliza un JSON privado con cuentas y datos QA, y exige un puerto local diferente de 8000 para evitar ejecutar sus capturas sobre la aplicación del usuario. Las credenciales de pruebas no forman parte del repositorio.
