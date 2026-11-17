// TODAS las llamadas al back viven en este archivo. Las pantallas nunca usan fetch directamente.
//
// Cada función hace una de dos cosas:
//   USE_MOCKS = true  -> responde con datos de ejemplo (js/mockapi.js + carpeta /mock). No necesitas el back.
//   USE_MOCKS = false -> llama al back real en API_BASE_URL.
//
// Las rutas de abajo son la PROPUESTA del front: el equipo de back las confirma o las cambia
// (basta con editar la ruta aquí). Lo que devuelva el back debe tener la misma forma que los
// datos de ejemplo: mira el archivo de /mock o la función de mockapi.js con el mismo nombre.
//
// Reglas con el back: JSON en ambos sentidos, token en el encabezado Authorization: Bearer <token>,
// 401 = sin sesión (el front regresa al login), 403 = sin permiso, errores como {"detail": "mensaje"}.

import { USE_MOCKS, API_BASE_URL, ALMACEN_API } from './config.js';
import { obtenerSesion, cerrarSesion } from './session.js';
import { ErrorApi } from './errores.js';
import * as mock from './mockapi.js';
import * as mockCalidad from './mockapi-calidad.js';
import * as mockOperacion from './mockapi-operacion.js';
import { consultarAlmacen, operarAlmacen } from './almacen-backend.js';
import { crearClienteCalidad } from '../integraciones/calidadApi.mjs';

export { ErrorApi };
export { reiniciarMocks } from './mockdb.js';

const RAIZ = new URL('../', import.meta.url);
export const sesionReal = () => ALMACEN_API && ['real', 'almacen'].includes(obtenerSesion()?.modo);
const gestion = (ruta, opciones) => pedir('/api/v1/gestion' + ruta, opciones);
const calidadReal = crearClienteCalidad(pedir);

async function pedir(ruta, { metodo = 'GET', cuerpo, publico = false } = {}) {
  const encabezados = { 'Content-Type': 'application/json' };
  const sesion = obtenerSesion();
  if (sesion?.token && !publico) encabezados.Authorization = `Bearer ${sesion.token}`;

  let respuesta;
  try {
    respuesta = await fetch(API_BASE_URL + ruta, {
      method: metodo,
      headers: encabezados,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch (e) {
    throw new ErrorApi('No se pudo conectar con el servidor. Revisa la red e inténtalo de nuevo.', 0);
  }

  if (respuesta.status === 401 && !publico) {
    cerrarSesion();
    location.replace(new URL('index.html', RAIZ));
    throw new ErrorApi('Tu sesión terminó. Vuelve a iniciar sesión.', 401);
  }
  if (!respuesta.ok) {
    const detalle = await respuesta.json().catch(() => ({}));
    const mensajes = { 403: 'No tienes permiso para hacer esto.', 404: 'No se encontró lo que buscabas.' };
    const texto = Array.isArray(detalle.detail) ? detalle.detail.map(e => e.msg).join('; ') : detalle.detail;
    throw new ErrorApi(texto || mensajes[respuesta.status] || 'Ocurrió un error en el servidor.', respuesta.status);
  }
  return respuesta.status === 204 ? null : respuesta.json();
}

// Arma "?turno=2&linea=L1" ignorando los filtros vacíos.
function consulta(filtros = {}) {
  const p = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  const texto = p.toString();
  return texto ? `?${texto}` : '';
}

// ---------------------------------------------------------------- Sesión
// Devuelve { token, usuario: { numEmpleado, nombre, rol }, permisos: { 'gerencia/dashboard': 'ver' | 'acciona', … }, acciones: [ids] }
export const iniciarSesion = (numEmpleado, contrasena, modo = 'demo') =>
  ['real', 'almacen'].includes(modo)
    ? pedir('/api/v1/auth/login', { metodo: 'POST', cuerpo: { usuario: numEmpleado, contrasena }, publico: true })
    : USE_MOCKS
    ? mock.iniciarSesion(numEmpleado, contrasena)
    : pedir('/auth/login', { metodo: 'POST', cuerpo: { numEmpleado, contrasena }, publico: true });

// Solo para la pantalla de login en modo ejemplo: lista de usuarios con los que se puede probar.
export const usuariosDeEjemplo = () => (USE_MOCKS ? mock.usuariosDeEjemplo() : Promise.resolve([]));
export const seriesDeEjemplo = (area = 'calidad') => (sesionReal() ? Promise.resolve([]) : USE_MOCKS ? mock.seriesDeEjemplo() : Promise.resolve([]));

// ---------------------------------------------------------------- Opciones de los filtros
// { lineas: ['L1',…], turnos: [{valor, nombre}], modelos: [...], ordenes: [{id, cliente, modelo, color}], clientes: [...], categoriasDefecto: [...] }
export const opciones = (area = 'gerencia') => (sesionReal() ? gestion('/opciones') : USE_MOCKS ? mock.opciones() : pedir('/opciones'));

// ---------------------------------------------------------------- Gerencia
// filtros: { turno, linea, modelo, orden } (vacío = todos)
export const dashboard = (filtros) => (sesionReal() ? gestion(`/dashboard${consulta(filtros)}`) : USE_MOCKS ? mock.dashboard(filtros) : pedir(`/tableros/dashboard${consulta(filtros)}`));

// filtros: { fecha: 'YYYY-MM-DD', turno, vista: 'lote' | 'linea' | 'modelo' }
export const discrepancias = (filtros) => (sesionReal() ? gestion(`/discrepancias${consulta(filtros)}`) : USE_MOCKS ? mock.discrepancias(filtros) : pedir(`/tableros/discrepancias${consulta(filtros)}`));

// filtros: { desde, hasta, linea, turno }
export const cierresTurno = (filtros) => (sesionReal() ? gestion(`/cierres-turno${consulta(filtros)}`) : USE_MOCKS ? mock.cierresTurno(filtros) : pedir(`/cierres-turno${consulta(filtros)}`));

// { pendientes: [...], resueltas: [...] }
export const autorizaciones = () => (sesionReal() ? gestion('/autorizaciones') : USE_MOCKS ? mock.autorizaciones() : pedir('/autorizaciones'));

// decision: 'aprobar' | 'rechazar'. Al rechazar, motivo es obligatorio.
export const resolverAutorizacion = (id, datos) =>
  sesionReal() ? gestion(`/autorizaciones/${encodeURIComponent(id)}/resolver`, { metodo: 'POST', cuerpo: datos }) : USE_MOCKS ? mock.resolverAutorizacion(id, datos) : pedir(`/autorizaciones/${encodeURIComponent(id)}/resolver`, { metodo: 'POST', cuerpo: datos });

// Datos de la unidad + historial + caja + embarque. 404 si la serie no existe.
export const unidadPorSerie = (serie, area = 'calidad') => (sesionReal() ? (area === 'gerencia' ? gestion(`/unidades/${encodeURIComponent(serie)}`) : calidadReal.buscarUnidad(serie)) : USE_MOCKS ? mock.unidadPorSerie(serie) : pedir(`/unidades/${encodeURIComponent(serie)}`));

// ---------------------------------------------------------------- Calidad
// Siempre es el día de hoy. filtros: { turno, linea } (vacío = todos)
// → { disposiciones: { liberadas, retenidas, retrabajo, scrap },
//     defectosPorCategoria: [{ categoria, cantidad, porcentaje }],
//     pendientes: [{ serie, modelo, color, lote, linea, turno, hora, fecha }]  (unidades probadas que esperan inspección) }
export const resumenCalidad = (filtros) => (sesionReal() ? calidadReal.obtenerResumen(filtros) : USE_MOCKS ? mockCalidad.resumenCalidad(filtros) : pedir(`/calidad/resumen${consulta(filtros)}`));

// Inspección de una unidad en estado PROBADA (los datos de la unidad salen de unidadPorSerie).
// datos: { defectos: [{ categoria, defecto, causa }], observaciones, disposicion: 'LIBERADA' | 'EN_RETENCION' | 'RETRABAJO' | 'SCRAP' }
// Para liberar no puede haber defectos; para las demás disposiciones, al menos uno. Necesita la acción de disposición de Calidad.
export const guardarInspeccion = (serie, datos) =>
  sesionReal() ? calidadReal.registrarInspeccion(serie, datos) : USE_MOCKS ? mockCalidad.guardarInspeccion(serie, datos) : pedir(`/unidades/${encodeURIComponent(serie)}/inspeccion`, { metodo: 'POST', cuerpo: datos });

// filtros: { q (serie), linea, modelo, fecha: 'YYYY-MM-DD' }
// → { filas: [{ serie, modelo, color, orden, lote, linea, turno, fecha, hora, inspector, categoria, motivo, observaciones }],
//     resumen: { retenidas, retenidasHoy } }
export const retenciones = (filtros) => (sesionReal() ? calidadReal.retenciones(filtros) : USE_MOCKS ? mockCalidad.retenciones(filtros) : pedir(`/calidad/retenciones${consulta(filtros)}`));

// datos: { disposicion: 'LIBERADA' (liberar) | 'RETRABAJO' (enviar a retrabajo) | 'EN_RETENCION' (mantener) | 'SCRAP', observaciones }
// Salvo «mantener», las observaciones son obligatorias (queda quién, cuándo y por qué).
export const resolverRetencion = (serie, datos) =>
  sesionReal() ? calidadReal.resolverRetencion(serie, datos) : USE_MOCKS ? mockCalidad.resolverRetencion(serie, datos) : pedir(`/unidades/${encodeURIComponent(serie)}/retencion/resolver`, { metodo: 'POST', cuerpo: datos });

// filtros: { q (serie), linea, modelo, fecha, estado: 'Pendiente' | 'Finalizado' }
// → { filas: [{ serie, modelo, color, orden, lote, linea, turno, fecha, estado, categoria, motivo, causa, fechaRetrabajo, descripcion, resultado, observaciones }],
//     resumen: { pendientes, finalizadas } }
export const retrabajos = (filtros) => (sesionReal() ? calidadReal.retrabajos(filtros) : USE_MOCKS ? mockCalidad.retrabajos(filtros) : pedir(`/calidad/retrabajos${consulta(filtros)}`));

// datos: { descripcion, resultado: 'Corregido' | 'No corregido', observaciones }. La unidad vuelve a Calidad para una nueva inspección.
export const guardarRetrabajo = (serie, datos) =>
  sesionReal() ? calidadReal.guardarRetrabajo(serie, datos) : USE_MOCKS ? mockCalidad.guardarRetrabajo(serie, datos) : pedir(`/unidades/${encodeURIComponent(serie)}/retrabajo`, { metodo: 'POST', cuerpo: datos });

// filtros: { desde, hasta, turno, linea, modelo }
// → { desde, hasta, total, disposiciones: { liberadas, retenidas, retrabajo, scrap }, totalDefectos,
//     defectosPorCategoria: [{ categoria, cantidad, porcentaje }], detalleDefectos: [{ categoria, defecto, cantidad, porcentaje }] }
export const reporteCalidad = (filtros) => (sesionReal() ? calidadReal.reportes(filtros) : USE_MOCKS ? mockCalidad.reporteCalidad(filtros) : pedir(`/calidad/reportes${consulta(filtros)}`));

// ---------------------------------------------------------------- Tickets de soporte
// Se llama SIN sesión (la persona no puede entrar). Devuelve { id }.
export const levantarTicket = (datos, modo = 'demo') =>
  ['real', 'almacen'].includes(modo) ? gestion('/tickets', { metodo: 'POST', cuerpo: datos, publico: true }) : USE_MOCKS ? mock.levantarTicket(datos) : pedir('/tickets', { metodo: 'POST', cuerpo: datos, publico: true });
export const tickets = () => (sesionReal() ? gestion('/tickets') : USE_MOCKS ? mock.tickets() : pedir('/tickets'));
export const ticket = (id) => (sesionReal() ? gestion(`/tickets/${encodeURIComponent(id)}`) : USE_MOCKS ? mock.ticket(id) : pedir(`/tickets/${encodeURIComponent(id)}`));
export const cerrarTicket = (id, datos) =>
  sesionReal() ? gestion(`/tickets/${encodeURIComponent(id)}/cerrar`, { metodo: 'POST', cuerpo: datos }) : USE_MOCKS ? mock.cerrarTicket(id, datos) : pedir(`/tickets/${encodeURIComponent(id)}/cerrar`, { metodo: 'POST', cuerpo: datos });

// ---------------------------------------------------------------- Usuarios, roles y permisos
export const usuarios = (q) => (sesionReal() ? gestion(`/usuarios${consulta({ q })}`) : USE_MOCKS ? mock.usuarios(q) : pedir(`/usuarios${consulta({ q })}`));
export const usuario = (numEmpleado) => (sesionReal() ? gestion(`/usuarios/${encodeURIComponent(numEmpleado)}`) : USE_MOCKS ? mock.usuario(numEmpleado) : pedir(`/usuarios/${encodeURIComponent(numEmpleado)}`));
export const guardarUsuario = (datos, esNuevo) =>
  sesionReal() ? gestion(esNuevo ? '/usuarios' : `/usuarios/${encodeURIComponent(datos.numEmpleado)}`, { metodo: esNuevo ? 'POST' : 'PUT', cuerpo: datos }) : USE_MOCKS
    ? mock.guardarUsuario(datos, esNuevo)
    : pedir(esNuevo ? '/usuarios' : `/usuarios/${encodeURIComponent(datos.numEmpleado)}`, { metodo: esNuevo ? 'POST' : 'PUT', cuerpo: datos });

// { roles: [{ nombre, descripcion, permisos: {pantalla: 'ver'|'acciona'}, acciones: [ids] }], pantallas: [...], acciones: [{id, nombre}] }
export const rolesPermisos = () => (sesionReal() ? gestion('/roles') : USE_MOCKS ? mock.rolesPermisos() : pedir('/roles'));
export const guardarRol = (nombre, datos) =>
  sesionReal() ? gestion(`/roles/${encodeURIComponent(nombre)}`, { metodo: 'PUT', cuerpo: datos }) : USE_MOCKS ? mock.guardarRol(nombre, datos) : pedir(`/roles/${encodeURIComponent(nombre)}`, { metodo: 'PUT', cuerpo: datos });

// ---------------------------------------------------------------- Catálogos y parámetros
// { modelos: { nombre: 'Modelos', items: [{codigo, nombre, estado}] }, lineas: {...}, … }
export const catalogos = (area = 'sistemas') => (sesionReal() ? (area === 'sistemas' ? gestion('/catalogos') : calidadReal.catalogos()) : USE_MOCKS ? mock.catalogos() : pedir('/catalogos'));
export const guardarElementoCatalogo = (tipo, elemento) =>
  sesionReal() ? gestion(`/catalogos/${encodeURIComponent(tipo)}`, { metodo: 'POST', cuerpo: elemento }) : USE_MOCKS ? mock.guardarElementoCatalogo(tipo, elemento) : pedir(`/catalogos/${encodeURIComponent(tipo)}`, { metodo: 'POST', cuerpo: elemento });
export const cambiarEstadoCatalogo = (tipo, codigo, estado) =>
  sesionReal() ? gestion(`/catalogos/${encodeURIComponent(tipo)}/${encodeURIComponent(codigo)}`, { metodo: 'PATCH', cuerpo: { estado } }) : USE_MOCKS
    ? mock.cambiarEstadoCatalogo(tipo, codigo, estado)
    : pedir(`/catalogos/${encodeURIComponent(tipo)}/${encodeURIComponent(codigo)}`, { metodo: 'PATCH', cuerpo: { estado } });

// { capacidadCaja: { 'NS-MINI': 12, … }, ultimoCambio: { por, fecha, hora, motivo } }
export const parametros = () => (sesionReal() ? gestion('/parametros') : USE_MOCKS ? mock.parametros() : pedir('/parametros'));
export const guardarParametros = (datos) => (sesionReal() ? gestion('/parametros', { metodo: 'PUT', cuerpo: datos }) : USE_MOCKS ? mock.guardarParametros(datos) : pedir('/parametros', { metodo: 'PUT', cuerpo: datos }));

// Contrato común de las pantallas operativas. La demo funciona sin servidor de API.
const almacenReal = area => sesionReal() && ['empaque', 'embarques'].includes(area);
export const consultarOperacion = (area, contexto = {}) => almacenReal(area) ? consultarAlmacen(contexto) : sesionReal() && area === 'prueba-funcional' ? pedir('/api/v1/pruebas/operacion') : sesionReal() && area === 'produccion' ? gestion('/operacion') : USE_MOCKS ? mockOperacion.consultarOperacion() : pedir('/operacion');
export const operar = (accion, datos, area) => almacenReal(area) ? operarAlmacen(accion, datos) : sesionReal() && area === 'prueba-funcional' ? (accion === 'guardarPrueba' ? pedir('/api/v1/pruebas/resultado', { metodo: 'POST', cuerpo: datos }) : Promise.reject(new ErrorApi('Operacion de pruebas no valida.', 404))) : sesionReal() && area === 'produccion' ? gestion(`/operacion/${encodeURIComponent(accion)}`, { metodo: 'POST', cuerpo: datos }) : USE_MOCKS ? mockOperacion.operar(accion, datos) : pedir(`/operacion/${encodeURIComponent(accion)}`, { metodo: 'POST', cuerpo: datos });
