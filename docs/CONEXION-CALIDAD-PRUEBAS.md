# Calidad y Pruebas funcionales conectadas

Entra en http://localhost:8000 con **Sistema conectado a PostgreSQL**. Cierra la sesión anterior y vuelve a entrar para cargar los permisos nuevos. El acceso de demostración sigue independiente.

## Integración de la rama

Se conservó la integración de Producción, cierres, Gerencia, Sistemas, Docker, sesiones, Empaque y Embarques. La rama `upstream/feature/calidad` aporta la estructura de inspección, consultas de unidades, categorías, estados y trazabilidad. Se adaptaron su autenticación y sus transacciones al servidor actual y se completaron los endpoints requeridos por las pantallas existentes.

La rama no incluía un backend operativo de Pruebas funcionales. Se añadió `backend/app/modules/pruebas.py`, conectado a las cuatro pantallas existentes y a la tabla `pruebas`.

## Recorrido real

1. **Operador → Producción:** registra una serie única. Se crea una unidad `ENSAMBLADA`.
2. **Operador → Pruebas funcionales:** evalúa Encendido, Audio, Carga y Bluetooth. Se requieren los cuatro resultados. Una falla exige observaciones y deja la unidad en `FALLA_FUNCIONAL`; puede volver a probarse después de corregirse. La aprobación completa la deja `PROBADA` y aparece en la cola de Calidad.
3. **Inspector de Calidad → Inspección:** registra defectos activos del catálogo. Solo una unidad probada puede inspeccionarse. Liberar exige cero defectos; retener, retrabajar o scrap exige un defecto. Scrap también requiere observaciones.
4. **Retenciones:** mantener, liberar, enviar a retrabajo o scrap. Cambiar la disposición exige observaciones. Se guardan la identidad del inspector y la decisión.
5. **Retrabajos:** registra descripción y resultado. La unidad vuelve a inspección; **No corregido** impide liberarla. Debe corregirse en otro ciclo o recibir una disposición distinta.
6. **Empaque:** únicamente acepta unidades `LIBERADA` con inspección vigente. Una unidad empacada, embarcada o scrap queda protegida contra cambios de Calidad y nuevas pruebas.
7. **Gerencia → Trazabilidad:** muestra ensamble, pruebas y responsables, inspecciones, retenciones, retrabajos, caja y embarque.

Los reportes cuentan la última disposición de cada unidad dentro del periodo, sin duplicar unidades reinspeccionadas. Los defectos cuentan hallazgos de inspección; revisar una retención no crea otro hallazgo. Se conservan los resultados históricos sin inventar evaluaciones que no estaban almacenadas.

## Usuarios y catálogos

La migración habilita Pruebas funcionales para los roles operativos existentes y las seis pantallas de Calidad para **Inspector de Calidad** y el rol heredado **Inspector Calidad**. El Administrador conserva el acceso completo. El servidor consulta los permisos de PostgreSQL en cada operación.

Desde Sistemas puedes administrar las cuentas del personal. No se crean cuentas operativas con contraseñas predeterminadas. Se utiliza la sesión como responsable; enviar otro `id_usuario` no permite hacerse pasar por otro inspector.

El catálogo inicial incorpora los defectos de Apariencia y Funcional definidos en el proyecto para las categorías existentes. Gestiona sus estados en **Sistemas → Catálogos**. Un defecto debe tener el prefijo de su categoría: `CAT1-01` pertenece a `CAT1`. Se mantienen los códigos ya configurados.

## Migración sobre un volumen existente

Respalda la base antes de actualizar. No elimines el volumen. Para una base nueva, Compose aplica automáticamente la migración 08. Sobre una base existente:

```powershell
docker compose up -d --wait db
docker compose exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/080_calidad_pruebas.sql'
docker compose up -d --build --wait app
```

`08_calidad_pruebas.sql` añade resultados detallados y responsables a Pruebas, observaciones y tipo de evento a Calidad, nombre de defecto y finalización de retrabajos. Los permisos nuevos se inicializan una sola vez. Repetirla conserva los permisos y catálogos editados después de activarla.

## Verificación

```powershell
python scripts/probar_todo.py
```

El ejecutor utiliza otra base, volumen y puerto. Verifica permisos, identidad, estados, concurrencia, pruebas incompletas, fallas, retenciones, retrabajos, scrap, reportes y Empaque. El navegador recorre las 41 pantallas conectadas y el flujo hasta embarcar una unidad. SQL confirma la persistencia y la repetición de las migraciones 07 y 08. La aplicación del puerto 8000 conserva sus registros.
