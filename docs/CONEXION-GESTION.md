# Producción, Gerencia y Sistemas conectados

Entra a `http://localhost:8000` y selecciona **Sistema conectado a PostgreSQL**. Usa las cuentas de la base, no los empleados de demostración. Si ya tenías sesión abierta, ciérrala y vuelve a entrar para cargar los nuevos menús.

## Alcance

- **Producción:** registra unidades ensambladas e incidencias; consulta tableros, confirma cierres y solicita correcciones o reaperturas.
- **Gerencia:** consulta indicadores, discrepancias, cierres y trazabilidad; aprueba o rechaza solicitudes según permisos.
- **Sistemas:** administra usuarios y sus estados, roles y permisos, catálogos, capacidad de cajas y tickets.
- **Empaque y Embarques:** conservan la conexión anterior. Las cajas nuevas usan las capacidades guardadas en Sistemas; las cajas existentes conservan su capacidad.
- **Pruebas funcionales y Calidad:** conectadas mediante la migración 08. Consulta [su guía](CONEXION-CALIDAD-PRUEBAS.md). El acceso de demostración sigue separado de PostgreSQL.

## Usuarios y permisos

La app crea una cuenta inicial con rol **Sistemas** al arrancar, tomando `SISTEMAS_USUARIO` (por defecto `sistemas`), `SISTEMAS_NOMBRE` y `SISTEMAS_PASSWORD` del `.env`. Define una contraseña de al menos ocho caracteres. Esta cuenta puede dar de alta al resto de los usuarios desde Sistemas, sin necesitar una captura manual en PostgreSQL. La inicialización se registra una sola vez y no sobrescribe cambios, bloqueos ni contraseñas en reinicios posteriores.

El Administrador conserva el acceso operativo anterior y recibe las nuevas áreas. Desde **Sistemas → Usuarios → Nuevo usuario**, crea las cuentas del personal y asigna su rol. Se puede usar un número de empleado o un identificador como `jperez`; la contraseña nueva requiere al menos ocho caracteres.

El Operador registra producción e incidencias. El Líder de línea cierra turnos y solicita ajustes. El Subgerente o Gerente de Producción resuelve solicitudes. El Gerente de Planta consulta indicadores. Los permisos se guardan por rol y el servidor los consulta en cada petición; después de editar un rol, vuelve a iniciar sesión para actualizar sus menús. Los roles de Calidad también utilizan el acceso conectado al aplicar la migración 08.

Las contraseñas se guardan con scrypt; las contraseñas heredadas se actualizan al iniciar sesión correctamente. No se devuelven en las consultas de usuarios. Bloquear o desactivar una cuenta, cambiar su contraseña o cambiar su rol revoca sus sesiones. El formulario protege la propia cuenta administrativa para evitar un bloqueo accidental.

Los tickets se pueden enviar desde **¿Olvidó la contraseña?**, seleccionando **Sistemas (cuenta real)**; aparecen en el área de tickets de Sistemas. El acceso demo envía tickets de demostración.

## Captura, cierre y autorización

1. Elige una orden existente, un turno activo, un código de lote y una serie única. La línea, el modelo, el color y el cliente proceden de la orden real.
2. El registro crea una unidad `ENSAMBLADA`, su ensamble y la bitácora. Debe aprobar Pruebas funcionales y recibir una liberación de Calidad antes de estar disponible para empacar.
3. El Líder confirma el cierre con una nota. Se guarda la foto de los conteos y se bloquea la captura para esa fecha, línea y turno, incluso si se intenta llamar directamente a la API.
4. El Líder solicita una corrección de conteo o una reapertura sobre el cierre de ese día, con un motivo de al menos diez caracteres.
5. Otra persona con permiso de Gerencia aprueba o rechaza. Un rechazo exige motivo. No se permiten autoautorizaciones, decisiones repetidas ni solicitudes que hayan quedado desactualizadas.
6. Una reapertura aprobada permite registrar unidades de nuevo. Una corrección modifica el conteo reportado con un ajuste auditable; no crea series, pruebas ni inspecciones ficticias.

Las fechas de estas operaciones corresponden a **America/Mexico_City**, independientemente de la zona horaria del contenedor. Los históricos existentes no se reescriben. Los cierres antiguos conservan sus totales almacenados; el total reportado se registra explícitamente a partir de esta integración.

Las órdenes, objetivos y colores existentes se reutilizan. Esta integración no añade una pantalla de alta de órdenes. Si no hay objetivos para el día, la meta muestra cero. Los catálogos inactivos impiden nuevas capturas y mantienen sus históricos. Para un modelo nuevo, configura su capacidad en Parámetros antes de crear cajas; el valor inicial 0 indica que falta configurarlo.

## Migración y arranque

Para una base nueva, Compose aplica automáticamente las migraciones 01, 02, 04, 05, 06 y **07**. Para un volumen existente, respalda la base y ejecuta la migración 07 una vez; se puede volver a ejecutar y conserva los permisos ya editados.

Desde PowerShell, en la raíz del proyecto:

```powershell
docker compose up -d db
docker compose exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/070_gestion.sql'
docker compose up -d --build app
```

No elimines el volumen para aplicar una migración. Las credenciales se toman del `.env` existente y la app conserva el puerto 8000.

## Verificación automática

```powershell
python scripts/probar_todo.py
```

El ejecutor crea otro proyecto Docker, otro volumen, contraseñas temporales y otro puerto. Ejecuta pruebas de API, base de datos, demostración y navegador real; comprueba el resultado directamente en SQL y retira sus recursos temporales. No utiliza la base de la app del puerto 8000.

Las pruebas de Gestión cubren permisos del servidor, series duplicadas y concurrentes, ensamble sin tocar Calidad, cierre y bloqueo, corrección de conteo, reapertura por otra persona, solicitudes desactualizadas, revocación de sesiones, catálogos y parámetros. El navegador comprueba las 18 pantallas nuevas y el flujo completo de Producción a Gerencia, además de las 13 pantallas reales de Almacén y las 41 pantallas demo.
