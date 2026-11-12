# Nova Sound · Front

HTML + Tailwind CSS + JavaScript sin framework. No hay que instalar nada ni compilar.

## Cómo abrirlo

1. Abre una terminal en esta carpeta.
2. Corre `python3 -m http.server 8000`.
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

**Qué incluye esta entrega:** Login, Levantar ticket y el área de Gerencia completa (Dashboard, Discrepancias, Autorizaciones, Trazabilidad y Cierres de turno). Las demás pantallas abren «pendiente» hasta que alguien las haga y marque `lista: true`. Por eso 9001, 1001, 3001, etc. aterrizan en esa pantalla.

En la pantalla de login hay un panel con estos mismos usuarios y un botón para **restablecer los datos de ejemplo** (los cambios que haces se guardan en el navegador).

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
