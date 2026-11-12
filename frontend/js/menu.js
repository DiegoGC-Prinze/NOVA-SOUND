// REGISTRO DE PANTALLAS: aquí se declara cada pantalla del sistema (43 en total).
// Lo usa la barra superior para armar el menú. Este archivo NO guarda permisos:
// qué rol ve qué pantalla lo decide el back (en el login devuelve `permisos`) y,
// mientras no esté listo, sale de mock/roles-permisos.json.
//
// CUANDO TERMINES UNA PANTALLA: cambia su `lista` a true. Mientras sea false, el menú
// la manda a pages/pendiente.html en vez de a un archivo que aún no existe.
// (Archivo generado el primer día; ya se puede editar a mano.)

export const ROLES = ["Operador", "Líder de línea", "Inspector de Calidad", "Almacén/Empaque", "Subgerente de Producción", "Gerente de Producción", "Gerente de Planta", "Administrador", "Supervisor de almacén"];

// Áreas, en el orden en que se muestran.
export const AREAS = {
  "login": "Inicio de sesión",
  "produccion": "Producción",
  "prueba-funcional": "Prueba funcional",
  "calidad": "Calidad",
  "empaque": "Empaque",
  "embarques": "Embarques",
  "gerencia": "Gerencia",
  "sistemas": "Sistemas"
};

// enMenu: false = la pantalla no sale como pestaña (se llega a ella desde otra, por ejemplo «Ver ticket»).
// padre: la pestaña que se queda marcada cuando estás en una pantalla de detalle.
export const PANTALLAS = [
  {"id": "login/login", "area": "login", "nombre": "Login", "ruta": "index.html", "lista": true, "enMenu": false},
  {"id": "login/levantar-ticket", "area": "login", "nombre": "Levantar ticket", "ruta": "pages/login/levantar-ticket.html", "lista": true, "enMenu": false},
  {"id": "produccion/tablero-de-produccion-del-turno", "area": "produccion", "nombre": "Tablero de producción del turno", "ruta": "pages/produccion/tablero-de-produccion-del-turno.html", "lista": false, "enMenu": true},
  {"id": "produccion/registrar-produccion", "area": "produccion", "nombre": "Registrar producción", "ruta": "pages/produccion/registrar-produccion.html", "lista": false, "enMenu": true},
  {"id": "produccion/registrar-incidencia", "area": "produccion", "nombre": "Registrar incidencia", "ruta": "pages/produccion/registrar-incidencia.html", "lista": false, "enMenu": true},
  {"id": "produccion/tablero-de-linea-lider", "area": "produccion", "nombre": "Tablero de línea (líder)", "ruta": "pages/produccion/tablero-de-linea-lider.html", "lista": false, "enMenu": true},
  {"id": "produccion/solicitar-ajuste", "area": "produccion", "nombre": "Solicitar ajuste", "ruta": "pages/produccion/solicitar-ajuste.html", "lista": false, "enMenu": true},
  {"id": "produccion/cierre-de-turno", "area": "produccion", "nombre": "Cierre de turno", "ruta": "pages/produccion/cierre-de-turno.html", "lista": false, "enMenu": true},
  {"id": "prueba-funcional/escanear-pieza-o-lote", "area": "prueba-funcional", "nombre": "Escanear pieza o lote", "ruta": "pages/prueba-funcional/escanear-pieza-o-lote.html", "lista": false, "enMenu": true},
  {"id": "prueba-funcional/registro-de-pruebas-funcionales", "area": "prueba-funcional", "nombre": "Registro de pruebas funcionales", "ruta": "pages/prueba-funcional/registro-de-pruebas-funcionales.html", "lista": false, "enMenu": true},
  {"id": "prueba-funcional/unidades-por-probar", "area": "prueba-funcional", "nombre": "Unidades por probar", "ruta": "pages/prueba-funcional/unidades-por-probar.html", "lista": false, "enMenu": true},
  {"id": "prueba-funcional/historial-de-pruebas", "area": "prueba-funcional", "nombre": "Historial de pruebas", "ruta": "pages/prueba-funcional/historial-de-pruebas.html", "lista": false, "enMenu": true},
  {"id": "calidad/resumen-de-calidad", "area": "calidad", "nombre": "Resumen de calidad", "ruta": "pages/calidad/resumen-de-calidad.html", "lista": false, "enMenu": true},
  {"id": "calidad/inspeccion-de-unidad", "area": "calidad", "nombre": "Inspección de unidad", "ruta": "pages/calidad/inspeccion-de-unidad.html", "lista": false, "enMenu": true},
  {"id": "calidad/retenciones", "area": "calidad", "nombre": "Retenciones", "ruta": "pages/calidad/retenciones.html", "lista": false, "enMenu": true},
  {"id": "calidad/retrabajos", "area": "calidad", "nombre": "Retrabajos", "ruta": "pages/calidad/retrabajos.html", "lista": false, "enMenu": true},
  {"id": "calidad/historial-de-la-unidad", "area": "calidad", "nombre": "Historial de la unidad", "ruta": "pages/calidad/historial-de-la-unidad.html", "lista": false, "enMenu": true},
  {"id": "calidad/reportes-de-calidad", "area": "calidad", "nombre": "Reportes de calidad", "ruta": "pages/calidad/reportes-de-calidad.html", "lista": false, "enMenu": true},
  {"id": "empaque/inicio-de-empaque-panel-de-control", "area": "empaque", "nombre": "Inicio de empaque (panel de control)", "ruta": "pages/empaque/inicio-de-empaque-panel-de-control.html", "lista": false, "enMenu": true},
  {"id": "empaque/formar-caja", "area": "empaque", "nombre": "Formar caja", "ruta": "pages/empaque/formar-caja.html", "lista": false, "enMenu": true},
  {"id": "empaque/confirmar-cierre-de-caja", "area": "empaque", "nombre": "Confirmar cierre de caja", "ruta": "pages/empaque/confirmar-cierre-de-caja.html", "lista": false, "enMenu": true},
  {"id": "empaque/consultar-caja", "area": "empaque", "nombre": "Consultar caja", "ruta": "pages/empaque/consultar-caja.html", "lista": false, "enMenu": true},
  {"id": "empaque/historial-de-cajas", "area": "empaque", "nombre": "Historial de cajas", "ruta": "pages/empaque/historial-de-cajas.html", "lista": false, "enMenu": true},
  {"id": "empaque/reportes-de-empaque", "area": "empaque", "nombre": "Reportes de empaque", "ruta": "pages/empaque/reportes-de-empaque.html", "lista": false, "enMenu": true},
  {"id": "embarques/armar-embarque", "area": "embarques", "nombre": "Armar embarque", "ruta": "pages/embarques/armar-embarque.html", "lista": false, "enMenu": true},
  {"id": "embarques/paquetes-en-embarcacion", "area": "embarques", "nombre": "Paquetes en embarcación", "ruta": "pages/embarques/paquetes-en-embarcacion.html", "lista": false, "enMenu": true},
  {"id": "embarques/cierre-de-caja-escaneo", "area": "embarques", "nombre": "Cierre de caja (escaneo)", "ruta": "pages/embarques/cierre-de-caja-escaneo.html", "lista": false, "enMenu": true},
  {"id": "embarques/confirmacion-de-cierre-de-caja", "area": "embarques", "nombre": "Confirmación de cierre de caja", "ruta": "pages/embarques/confirmacion-de-cierre-de-caja.html", "lista": false, "enMenu": true},
  {"id": "embarques/estado-del-embarque", "area": "embarques", "nombre": "Estado del embarque", "ruta": "pages/embarques/estado-del-embarque.html", "lista": false, "enMenu": true},
  {"id": "embarques/rastreo-de-contenedor", "area": "embarques", "nombre": "Rastreo de contenedor", "ruta": "pages/embarques/rastreo-de-contenedor.html", "lista": false, "enMenu": true},
  {"id": "embarques/grafica-de-embarques", "area": "embarques", "nombre": "Gráfica de embarques", "ruta": "pages/embarques/grafica-de-embarques.html", "lista": false, "enMenu": true},
  {"id": "gerencia/dashboard", "area": "gerencia", "nombre": "Dashboard", "ruta": "pages/gerencia/dashboard.html", "lista": true, "enMenu": true},
  {"id": "gerencia/discrepancias", "area": "gerencia", "nombre": "Discrepancias", "ruta": "pages/gerencia/discrepancias.html", "lista": true, "enMenu": true},
  {"id": "gerencia/autorizaciones", "area": "gerencia", "nombre": "Autorizaciones", "ruta": "pages/gerencia/autorizaciones.html", "lista": true, "enMenu": true},
  {"id": "gerencia/trazabilidad", "area": "gerencia", "nombre": "Trazabilidad", "ruta": "pages/gerencia/trazabilidad.html", "lista": true, "enMenu": true},
  {"id": "gerencia/cierres-de-turno", "area": "gerencia", "nombre": "Cierres de turno", "ruta": "pages/gerencia/cierres-de-turno.html", "lista": true, "enMenu": true},
  {"id": "sistemas/area-de-tickets", "area": "sistemas", "nombre": "Área de tickets", "ruta": "pages/sistemas/area-de-tickets.html", "lista": false, "enMenu": true},
  {"id": "sistemas/ver-ticket", "area": "sistemas", "nombre": "Ver ticket", "ruta": "pages/sistemas/ver-ticket.html", "lista": false, "enMenu": false, "padre": "sistemas/area-de-tickets"},
  {"id": "sistemas/usuarios", "area": "sistemas", "nombre": "Usuarios", "ruta": "pages/sistemas/usuarios.html", "lista": false, "enMenu": true},
  {"id": "sistemas/nuevo-o-editar-usuario", "area": "sistemas", "nombre": "Nuevo o editar usuario", "ruta": "pages/sistemas/nuevo-o-editar-usuario.html", "lista": false, "enMenu": false, "padre": "sistemas/usuarios"},
  {"id": "sistemas/roles-y-permisos", "area": "sistemas", "nombre": "Roles y permisos", "ruta": "pages/sistemas/roles-y-permisos.html", "lista": false, "enMenu": true},
  {"id": "sistemas/catalogos", "area": "sistemas", "nombre": "Catálogos", "ruta": "pages/sistemas/catalogos.html", "lista": false, "enMenu": true},
  {"id": "sistemas/parametros", "area": "sistemas", "nombre": "Parámetros", "ruta": "pages/sistemas/parametros.html", "lista": false, "enMenu": true},
];

export function buscarPantalla(id) {
  return PANTALLAS.find((p) => p.id === id) || null;
}
