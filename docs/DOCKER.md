# NOVA SOUND con Docker y PostgreSQL

## Inicio en Windows / PowerShell

Requisitos: Docker Desktop iniciado, contenedores Linux y Docker Compose.

Desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
```

Si `.env` ya existe, edítalo sin reemplazarlo. Completa estas variables:

```dotenv
DB_NAME=nova_sounds
DB_USER=nova_app
DB_PASSWORD='escribe_aqui_tu_contrasena'
APP_PORT=8000
SISTEMAS_USUARIO=sistemas
SISTEMAS_NOMBRE=Sistemas
SISTEMAS_PASSWORD='elige_una_contrasena_de_al_menos_8_caracteres'
```

`DB_USER` y `DB_PASSWORD` son el usuario y contraseña de PostgreSQL. No son las cuentas de Login del frontend. Las comillas simples permiten escribir `$` y `#` sin que Compose los interprete como variables o comentarios. El `.env` se excluye de Git y de la imagen Docker.

Después:

```powershell
docker compose up -d --build --wait
docker compose ps
```

Al arrancar, la API crea una sola vez la cuenta `SISTEMAS_USUARIO` con el rol **Sistemas** y la contraseña `SISTEMAS_PASSWORD`. Entra en **Sistema conectado a PostgreSQL** y usa **Sistemas → Usuarios** para registrar al personal. Esta cuenta administra usuarios, roles, catálogos, parámetros y tickets; sus permisos iniciales corresponden al área de Sistemas.

La contraseña se almacena con scrypt y no se imprime en los logs. Los reinicios no duplican la cuenta, no restablecen su contraseña ni revierten bloqueos o cambios de permisos. Después del alta, cambia contraseñas y estados desde Usuarios; editar el `.env` no restablece la cuenta. El alta funciona también sobre un volumen existente con las migraciones aplicadas, conservando los demás usuarios. Una cuenta existente con otro rol y el mismo identificador impide el alta para evitar sobrescribirla.

| Dirección | Servicio |
|---|---|
| http://localhost:8000 | Frontend |
| http://localhost:8000/docs | Swagger del backend |
| http://localhost:8000/openapi.json | Contrato de la API |
| http://localhost:8000/api/v1/health | Estado del servidor y conexión real a PostgreSQL |
| http://localhost:8000/api/v1/almacen/panel | Consulta del módulo de Almacén |

Mantén libre el puerto 8000. Si ya tienes `python -m http.server 8000` de las pruebas del frontend, detenlo con Ctrl+C en su terminal antes de iniciar Docker.

## Servicios y persistencia

- `app`: Python 3.12 y FastAPI, con el frontend servido por la misma aplicación en el puerto 8000.
- `db`: PostgreSQL 16 en el puerto **interno** 5432, sin publicar el puerto en Windows. Esto permite coexistir con otra instalación de PostgreSQL en tu equipo.
- La API se conecta a `db:5432`; no utiliza `localhost` dentro del contenedor.
- El volumen `postgres_data` conserva los datos al reiniciar o recrear contenedores.
- El backend espera a que la base termine de inicializarse. El indicador de salud de la app ejecuta `SELECT 1` contra PostgreSQL.

La base se crea usando `POSTGRES_DB`. Al iniciar un volumen vacío se ejecutan, en orden, los archivos del repositorio:

1. `01_esquema_postgresql.sql` — tablas y relaciones.
2. `02_datos_postgresql.sql` — datos de demostración.
3. `04_modulo_almacen.sql` — columnas e índices del módulo.
4. `05_catalogo_modelos_oficiales.sql` — catálogo oficial.
5. `06_integracion_frontend.sql` — sesiones y datos de Empaque/Embarques.
6. `07_produccion_sistemas_gerencia.sql` — permisos, usuarios, cierres, producción y Sistemas.
7. `08_calidad_pruebas.sql` — resultados funcionales, Calidad, defectos, retrabajos y permisos nuevos.
8. `03_verificacion_postgresql.sql` — consultas de comprobación.

`00_crear_base.sql` no se monta: la imagen de PostgreSQL ya crea la base solicitada. El esquema se administra con los SQL del proyecto; no se ejecuta `Base.metadata.create_all()`.

Los scripts de inicialización se aplican **solo la primera vez sobre un volumen vacío**. Cambiar un SQL o las credenciales del `.env` después no migra una base existente ni cambia automáticamente sus contraseñas. Los cambios posteriores requieren una migración o un cambio de usuario/contraseña en PostgreSQL, conservando el volumen.

Si falla un SQL durante la primera inicialización, revisa los logs antes de reiniciar: puede quedar una base parcialmente preparada. No ejecutes repetidamente el seed ni borres volúmenes con datos que quieras conservar.

## Consultas y mantenimiento

Ver logs:

```powershell
docker compose logs --tail 100 app db
```

Abrir `psql` dentro del contenedor, sin escribir la contraseña en la terminal:

```powershell
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Dentro de `psql` puedes ejecutar `\dt`, consultar tablas y salir con `\q`.

Detener los servicios conservando el volumen:

```powershell
docker compose down
```

Volver a iniciar:

```powershell
docker compose up -d --wait
```

No uses `down -v` si quieres conservar los datos: esa opción elimina el volumen.

## Credenciales para desarrollo sin Docker

El archivo `backend/.env.example` sirve para ejecutar Python directamente en Windows. En ese caso se copia a `backend/.env` y se configura el host/puerto de una base accesible desde Windows.

Para Docker solo se configura el `.env` de la **raíz**. Compose pasa las variables a ambos servicios; los archivos `.env` no se copian a la imagen.

## Estado de la integración funcional

Este conjunto levanta el frontend, la API de Almacén y PostgreSQL. El login permite seleccionar **Almacén y Embarques** para operar con la base real, o **Demostración de otras áreas** para conservar las pruebas locales. No se transfieren automáticamente a PostgreSQL los registros guardados previamente en el navegador.

La API autentica las escrituras mediante sesiones reales y revocables; `ALMACEN_DEV_MODE` permanece en `0`. Las 41 pantallas de todas las áreas están conectadas, incluidas Pruebas funcionales y Calidad mediante la [migración 08](CONEXION-CALIDAD-PRUEBAS.md). Consulta [la guía de Almacén](CONEXION-ALMACEN.md) para la migración 06 y [la guía de Gestión](CONEXION-GESTION.md) para la migración 07 sobre un volumen existente. Mantén `USE_MOCKS`: el acceso real se selecciona en el login.

## Pruebas del backend dentro de Docker

Construir y ejecutar las pruebas unitarias, sin conectar a una base real:

```powershell
docker build --target test -f backend/Dockerfile -t nova-sound-tests .
docker run --rm nova-sound-tests
```

Las pruebas de integración PostgreSQL permanecen omitidas hasta habilitar explícitamente `ALMACEN_RUN_INTEGRATION=1` y preparar una base separada cuyo nombre termine en `_test`, con las migraciones 04, 05, 06, 07 y 08. El ejecutor `python scripts/probar_todo.py` prepara esa base automáticamente. No deben ejecutarse sobre la base de la aplicación.

## Validación realizada

Se construyeron las imágenes y se levantó un proyecto temporal en el puerto 8000, con credenciales aleatorias y un volumen independiente:

- Frontend, archivos JavaScript, Swagger, OpenAPI y consultas de Almacén: HTTP 200.
- Salud de la API: conexión real a PostgreSQL correcta.
- Inicialización completa: 50 unidades del seed y migraciones aplicadas.
- Backend: 27 pruebas aprobadas, incluidas 6 contra una base PostgreSQL separada de pruebas.
- Comando sin credenciales ni base: 21 pruebas aprobadas y 6 de integración omitidas.
- Frontend servido desde Docker: 17 escenarios aprobados, con navegación por las 41 pantallas y datos de demostración en un perfil temporal del navegador.
- Persistencia: un registro de comprobación permaneció después de recrear los dos contenedores; el seed no se duplicó.

Al terminar se retiraron los recursos temporales. No se creó un `.env` con credenciales definitivas ni se modificaron otros contenedores del equipo.

Referencias: [orden de inicio en Compose](https://docs.docker.com/compose/how-tos/startup-order/), [inicialización y volumen de la imagen oficial PostgreSQL](https://hub.docker.com/_/postgres), [archivos estáticos con FastAPI](https://fastapi.tiangolo.com/tutorial/static-files/).
