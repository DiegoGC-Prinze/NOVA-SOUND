# NOVA-SOUND
Sistema web de gestión de producción, calidad, trazabilidad y embarques de NOVA SOUND

## Docker: aplicación en el puerto 8000

Con Docker Desktop iniciado, desde la raíz del proyecto:

```powershell
Copy-Item .env.example .env
```

Completa `DB_PASSWORD` en `.env` y revisa `DB_NAME` / `DB_USER`. Si el archivo ya existe, edítalo sin reemplazarlo. Después ejecuta:

```powershell
docker compose up -d --build --wait
```

Abre **http://localhost:8000** para el frontend y **http://localhost:8000/docs** para la API. PostgreSQL se inicializa con el esquema, datos de ejemplo y migraciones de Almacén en un volumen persistente.

Todas las áreas operan con PostgreSQL seleccionando **Sistema conectado a PostgreSQL** en el login: Producción, Pruebas funcionales, Calidad, cierres, Gerencia, Sistemas, Empaque y Embarques. Al arrancar se crea una cuenta inicial con rol **Sistemas** usando `SISTEMAS_USUARIO` y `SISTEMAS_PASSWORD` del `.env`, para dar de alta al personal. Los reinicios conservan sus cambios. Consulta [Calidad y Pruebas](docs/CONEXION-CALIDAD-PRUEBAS.md), [Gestión](docs/CONEXION-GESTION.md), [Almacén](docs/CONEXION-ALMACEN.md) y [Docker](docs/DOCKER.md). Las pruebas completas se ejecutan con `python scripts/probar_todo.py` en contenedores y bases temporales; la demostración sigue disponible por separado.

## Restaurar un respaldo .dump

Para cargar `database/demo/nova_sound_presentacion.dump` en el servicio `db` del proyecto principal usando el `.env` de la raíz:

```powershell
python scripts/restaurar_dump.py --verificar
python scripts/restaurar_dump.py
```

La primera orden solo valida. La segunda pide confirmar el destino, guarda un respaldo previo en `respaldos/` y reemplaza los datos incluidos en el dump. También acepta la ruta de otro `.dump`. Consulta los detalles en [la guía de Docker](docs/DOCKER.md#restaurar-un-archivo-dump-en-el-contenedor-principal).

## Todas las pruebas

```powershell
python scripts/probar_todo.py
```

Requiere Docker Desktop, Python, Node.js 22 o superior y Edge/Chrome. Prepara y elimina su propio entorno de pruebas; conserva la aplicación del puerto 8000. Detalles y resultados esperados: [guía de pruebas](docs/PRUEBAS.md).
