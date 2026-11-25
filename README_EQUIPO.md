# NOVA SOUND para el equipo

Este paquete incorpora los scripts de simulación y un respaldo de PostgreSQL 16 de `Ultimate-branch`, conservando el frontend y las pantallas de la rama actual. El respaldo contiene **129,955 unidades, 15,327 cajas, 2,270 embarques y 192 cierres**. El periodo simulado va del **25 de octubre al 25 de noviembre de 2026**, con dos turnos por día.

## Primer arranque

1. Usa la rama `feature/simulacion-industrial`, que integra este paquete de simulación.
2. Si todavía no tienes un archivo `.env` en ese checkout, copia `.env.example` a `.env`.
3. Completa `DB_PASSWORD` y `SISTEMAS_PASSWORD` con contraseñas locales. La contraseña de Sistemas debe tener al menos ocho caracteres. El número de empleado inicial predeterminado es **9001**. Este perfil usa el puerto **8002**, separado de la aplicación principal del puerto 8000. Puedes cambiarlo con `EQUIPO_APP_PORT`.
4. Con Docker iniciado, ejecuta desde la raíz:

   ```bash
   docker compose -f compose.yaml -f compose.equipo.yaml up -d --build --wait
   ```

5. Abre **http://localhost:8002** o el puerto que configuraste con `EQUIPO_APP_PORT`. Elige **Sistema conectado a PostgreSQL** e inicia sesión con el número y contraseña de Sistemas de tu `.env`.

El respaldo se restaura al inicializar el volumen de **nova-sound-equipo**. En arranques posteriores el volumen conserva los cambios. Para hacer otra instalación desde el respaldo y conservar tu instancia anterior, usa un nombre de proyecto y un puerto distintos con `-p` y `EQUIPO_APP_PORT`.

## Accesos y verificación

El respaldo incluye cuentas históricas anonimizadas para conservar la trazabilidad. En **Sistemas → Usuarios** puedes crear cuentas nuevas o asignar contraseñas nuevas a las existentes. Para una cuenta con acceso a todas las áreas, asigna el rol **Administrador** desde **Sistemas → Usuarios**. Si el rol aún no figura en tu instalación, créalo desde **Catálogos → Roles**.

Para comprobar la restauración, ejecuta:

```bash
docker compose -f compose.yaml -f compose.equipo.yaml exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS unidades, min(fecha_hora::date) AS desde, max(fecha_hora::date) AS hasta FROM unidades"'
```

La primera instalación debe mostrar **129955** unidades. Para revisar el histórico en los reportes, selecciona las fechas **2026-10-25 a 2026-11-25**. Los indicadores del turno actual usan la fecha de la aplicación.

La configuración habitual sin `compose.equipo.yaml` sigue disponible para pruebas con la base inicial del repositorio. El generador [inyectar_periodo.py](scripts/simulacion/inyectar_periodo.py) permite producir otros periodos en el entorno de simulación del proyecto.

## Generar otro período

Para revisar el plan sin escribir en PostgreSQL:

```powershell
python scripts/simulacion/inyectar_periodo.py --desde 2026-10-25 --hasta 2026-11-25
```

`--aplicar` crea una base nueva cuyo nombre debe terminar en `_simulacion`, distinta de `nova_sounds_simulacion`. El origen debe tener las cuentas operativas activas de Operador, Líder, Calidad, Empaque y Embarques. El generador también reconoce los nombres actuales `Operador / Pruebas Funcionales` y `Almacén/Empaque`, sin renombrar roles. Usa `--proyecto` y `--env-file` para seleccionar el entorno de simulación; por defecto usa `nova-sound-simulacion` y `.env.simulacion`. La aplicación conserva su conexión anterior hasta que se configure expresamente el cambio.

El respaldo también se puede validar con el restaurador de esta rama, sin cargar datos:

```powershell
python scripts/restaurar_dump.py database/demo/nova_sound_equipo.pgdump --verificar
```
