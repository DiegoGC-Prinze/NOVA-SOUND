# Nova Sound · Front

HTML + Tailwind CSS + JavaScript sin framework. No hay que instalar nada ni compilar.

## Acceso real de Almacén y Embarques

En Docker, abre http://localhost:8000 y selecciona **Sistema conectado a PostgreSQL**. Producción, cierres, Gerencia, Sistemas, Empaque y Embarques usan datos reales; Pruebas funcionales y Calidad también usan PostgreSQL mediante la migración 08; consulta [su guía](../docs/CONEXION-CALIDAD-PRUEBAS.md). Usa una cuenta de la tabla PostgreSQL `usuarios`; el seed original incluye `admin` / `pass123`, si no fue cambiado. Las cuentas `4001` / `nova123` son de la demo y no autentican en PostgreSQL. Consulta [la guía de Gestión](../docs/CONEXION-GESTION.md) para usuarios, permisos, cierres y la migración 07.

Las 13 pantallas de esas áreas guardan por API al entrar con una sesión real. Muestran **Datos de PostgreSQL** y conservan cajas, contenido, solicitudes, destino, contenedor y salida en la base de datos. Para las demás áreas elige **Demostración de otras áreas**. Más detalles y creación de usuarios: [conexión de Almacén](../docs/CONEXION-ALMACEN.md).

## Cómo abrirlo

1. Abre una terminal en esta carpeta.
2. Corre `python -m http.server 8000` (o `python3 -m http.server 8000` en Linux/macOS).
3. Entra a <http://localhost:8000>.

No sirve abrir `index.html` con doble clic: el navegador bloquea los módulos de JavaScript si el archivo viene de `file://`. (También funciona la extensión Live Server de VS Code.)

**Si Live Server o Python no te funcionan (Windows):** doble clic en `ABRIR-SIN-SERVIDOR.bat`. Abre Edge en una ventana aparte, con su propio perfil, que sí puede leer los archivos de la carpeta. Úsala solo para Nova Sound, no para navegar por otras páginas.

## Usuarios de ejemplo (contraseña de todos: `nova123`)

| N.º de empleado | Rol | Aterriza en |
|---|---|---|
| 5002 | Gerente de Producción | Gerencia · Dashboard |
| 5001 | Subgerente de Producción | Gerencia · Dashboard |
| 6001 | Gerente de Planta (solo consulta en Autorizaciones) | Gerencia · Dashboard |
| 9001 | Administrador | Sistemas |
| 1001 | Operador | Producción |
| 2001 | Líder de línea | Producción |
| 3001 | Inspector de Calidad | Prueba funcional |
| 4001 | Almacén/Empaque | Empaque |
| 4002 | Supervisor de almacén | Empaque |
| 1003 | Operador con cuenta **bloqueada** (para probar el aviso y «Levantar ticket») | — |

**Qué incluye esta entrega:** las pantallas de Erik y Jesús integradas, con Producción, Prueba funcional, Calidad, Empaque, Embarques, Gerencia y Sistemas. `USE_MOCKS = true` permite ejecutar el recorrido completo sin backend. Los registros se conservan en el almacenamiento local del navegador, en el mismo perfil y dirección del sitio.

En la pantalla de login hay un panel con estos mismos usuarios y un botón para **restablecer los datos de ejemplo** (los cambios que haces se guardan en el navegador).

## Probar el recorrido completo sin backend

1. Como **1001**, abre Producción → Registrar producción. Elige una orden y un turno, escribe lote y serie única. La orden determina línea, modelo, cliente y color.
2. Con el mismo usuario, cambia al área Prueba funcional → Unidades por probar. Abre Registrar prueba, evalúa encendido, audio, carga y Bluetooth y guarda. Una falla requiere observaciones y queda disponible para repetir la prueba; una aprobación pasa a Calidad.
3. Cierra sesión y entra como **3001**. Cambia al área Calidad → Resumen de calidad o busca la serie en Inspección de unidad. Da la disposición **Liberada** para continuar. Retención, retrabajo y scrap impiden empacar.
4. Como **4001**, abre Empaque → Formar caja. Crea una caja para la misma orden y agrega la serie. El contenido se conserva al cambiar de pantalla. Cierra la caja; si está incompleta es obligatorio indicar el motivo.
5. Cambia al área Embarques → Armar embarque. Crea el embarque para esa orden, indica destino y contenedor, asigna la caja cerrada y confirma su salida.
6. Como **5002**, consulta Gerencia → Trazabilidad con la misma serie. El historial muestra producción, prueba, inspección, caja y salida.

Los datos de ejemplo históricos se conservan. La cola de pruebas empieza vacía hasta registrar unidades nuevas; las cajas y los embarques nuevos se consultan en todas las pantallas de sus áreas. Usa los enlaces «Continuar» o «Ver embarque» para retomar registros guardados.

El **2001** puede cerrar una línea y turno; el registro de unidades para ese turno queda bloqueado. Para corregir el conteo o reabrirlo, envía una solicitud desde Producción → Solicitar ajuste y resuélvela como **5001** o **5002** en Gerencia → Autorizaciones. Las solicitudes y sus resoluciones se conservan. Los cambios de capacidad de **9001** en Sistemas → Parámetros se aplican a las cajas abiertas y a las cajas nuevas. Las cajas ya cerradas conservan la capacidad con la que se cerraron.

Si ya tenías sesión abierta antes de actualizar el frontend, sal y vuelve a entrar para cargar los permisos de las dos pantallas nuevas de Embarques. La migración de permisos conserva los demás datos guardados.

La persistencia es local: otro navegador, perfil, puerto o equipo tiene datos independientes. Borrar los datos del sitio o usar «Restablecer los datos de ejemplo» elimina los cambios de esta demo.

## Verificación automática

Desde la raíz del repositorio, con Node.js 22 o superior y Edge/Chrome instalado:

```powershell
node frontend/tests/frontend.test.mjs
```

No instala paquetes. Inicia un servidor local y un perfil temporal del navegador, recorre las 41 pantallas con sus roles y verifica el flujo completo, persistencia, validaciones, concurrencia, permisos, cierres y autorizaciones. Cierra el servidor y el navegador al terminar y muestra la ruta temporal de los resultados. Puedes definir `NOVA_TEST_BROWSER` con la ruta del navegador si no está en una ubicación habitual.

## Cómo hacer tu pantalla (3 pasos)

1. **HTML:** copia `pages/gerencia/dashboard.html` a la carpeta de tu área y cambia el `<title>` y el nombre del script del final.
2. **JS:** copia `js/pantallas/gerencia-dashboard.js`, déjale la estructura y cambia el id: `montarPagina('area/pantalla')`. El id es el de `js/menu.js`.
3. **Menú:** en `js/menu.js` cambia `lista` a `true` en tu pantalla. Mientras sea `false`, el menú manda a `pages/pendiente.html`.

`montarPagina(id)` hace todo lo común: revisa que haya sesión, revisa el permiso, dibuja la barra superior y devuelve:

```js
const pagina = montarPagina('gerencia/dashboard');
// null si no hay sesión o permiso (ya se dibujó el aviso); si no:
// { sesion, contenido, pantalla, puedeAccionar, puede(accion) }
if (pagina) iniciar(pagina);   // siempre al FINAL del archivo
```

- `puedeAccionar` es `false` cuando el rol solo puede **ver** la pantalla: oculta o desactiva ahí los botones que modifican algo.
- Todo dato que venga del back y se meta en HTML pasa por `esc()` (en `js/ui.js`). Los componentes ya lo hacen.

## Qué hay ya hecho para reutilizar

- `js/componentes.js`: `boton`, `chip`, `chipUnidad`, `encabezado`, `tarjeta`, `indicador`, `barra`, `aviso`, `campo`, `marcarError`, `tabla`, `cargarEn` (carga con «Cargando…», vacío y error ya resueltos), `mostrarAviso`, `mostrarAvisoDespues`, `preguntar` (cuadro de confirmación con motivo opcional).
- `js/ui.js`: formato de números, porcentajes, fechas, turno por hora, `descargarCSV`.
- `js/pantallas/historial-unidad.js`: el historial de una unidad (lo usa Trazabilidad y lo usará Calidad; no lo dupliques).
- `css/tema.css`: colores y clases (`btn-principal`, `tarjeta`, `chip-*`, `tabla`…). **No pongas colores a mano** en las pantallas; si hace falta uno nuevo se agrega aquí.

## Mocks y back real

`js/config.js` tiene `USE_MOCKS = true`: las pantallas leen `mock/*.json` y lo que cambies se guarda en el navegador. Para conectar el back: `USE_MOCKS = false` y poner `API_BASE_URL`.

Todas las llamadas están en **`js/api.js`**, y es el único archivo que sabe de rutas. Rutas que propone el front (el back las puede cambiar y solo se ajusta ese archivo):

| Función | Ruta |
|---|---|
| `iniciarSesion` | `POST /auth/login` → `{ token, usuario, permisos, acciones }` |
| `opciones` | `GET /opciones` (modelos, líneas, turnos, órdenes) |
| `dashboard` | `GET /tableros/dashboard?turno&linea&modelo&orden` |
| `discrepancias` | `GET /tableros/discrepancias?fecha&turno&vista` |
| `cierresTurno` | `GET /cierres-turno?desde&hasta&linea&turno` |
| `autorizaciones` / `resolverAutorizacion` | `GET /autorizaciones` · `POST /autorizaciones/{id}/resolver` |
| `unidadPorSerie` | `GET /unidades/{serie}` |
| `levantarTicket` | `POST /tickets` (sin token) |

Errores: `{"detail": "texto"}` con 401 (sesión), 403 (permiso), 404, 422. El front muestra ese `detail` tal cual al usuario, así que debe ser un texto que se entienda.

La forma exacta de cada respuesta es la de los archivos de `mock/`.
