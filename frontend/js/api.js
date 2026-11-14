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

import { USE_MOCKS, API_BASE_URL } from './config.js';
import { obtenerSesion, cerrarSesion } from './session.js';
import { ErrorApi } from './errores.js';
import * as mock from './mockapi.js';

export { ErrorApi };
export { reiniciarMocks } from './mockdb.js';

const RAIZ = new URL('../', import.meta.url);

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
    throw new ErrorApi(detalle.detail || mensajes[respuesta.status] || 'Ocurrió un error en el servidor.', respuesta.status);
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
export const iniciarSesion = (numEmpleado, contrasena) =>
  USE_MOCKS
    ? mock.iniciarSesion(numEmpleado, contrasena)
    : pedir('/auth/login', { metodo: 'POST', cuerpo: { numEmpleado, contrasena }, publico: true });

// Solo para la pantalla de login en modo ejemplo: lista de usuarios con los que se puede probar.
export const usuariosDeEjemplo = () => (USE_MOCKS ? mock.usuariosDeEjemplo() : Promise.resolve([]));
export const seriesDeEjemplo = () => (USE_MOCKS ? mock.seriesDeEjemplo() : Promise.resolve([]));

// ---------------------------------------------------------------- Opciones de los filtros
// { lineas: ['L1',…], turnos: [{valor, nombre}], modelos: [...], ordenes: [{id, cliente, modelo, color}], clientes: [...], categoriasDefecto: [...] }
export const opciones = () => (USE_MOCKS ? mock.opciones() : pedir('/opciones'));

// ---------------------------------------------------------------- Gerencia
// filtros: { turno, linea, modelo, orden } (vacío = todos)
export const dashboard = (filtros) => (USE_MOCKS ? mock.dashboard(filtros) : pedir(`/tableros/dashboard${consulta(filtros)}`));

// filtros: { fecha: 'YYYY-MM-DD', turno, vista: 'lote' | 'linea' | 'modelo' }
export const discrepancias = (filtros) => (USE_MOCKS ? mock.discrepancias(filtros) : pedir(`/tableros/discrepancias${consulta(filtros)}`));

// filtros: { desde, hasta, linea, turno }
export const cierresTurno = (filtros) => (USE_MOCKS ? mock.cierresTurno(filtros) : pedir(`/cierres-turno${consulta(filtros)}`));

// { pendientes: [...], resueltas: [...] }
export const autorizaciones = () => (USE_MOCKS ? mock.autorizaciones() : pedir('/autorizaciones'));

// decision: 'aprobar' | 'rechazar'. Al rechazar, motivo es obligatorio.
export const resolverAutorizacion = (id, datos) =>
  USE_MOCKS ? mock.resolverAutorizacion(id, datos) : pedir(`/autorizaciones/${encodeURIComponent(id)}/resolver`, { metodo: 'POST', cuerpo: datos });

// Datos de la unidad + historial + caja + embarque. 404 si la serie no existe.
export const unidadPorSerie = (serie) => (USE_MOCKS ? mock.unidadPorSerie(serie) : pedir(`/unidades/${encodeURIComponent(serie)}`));

// ---------------------------------------------------------------- Tickets de soporte
// Se llama SIN sesión (la persona no puede entrar). Devuelve { id }.
export const levantarTicket = (datos) =>
  USE_MOCKS ? mock.levantarTicket(datos) : pedir('/tickets', { metodo: 'POST', cuerpo: datos, publico: true });
export const tickets = () => (USE_MOCKS ? mock.tickets() : pedir('/tickets'));
export const ticket = (id) => (USE_MOCKS ? mock.ticket(id) : pedir(`/tickets/${encodeURIComponent(id)}`));
export const cerrarTicket = (id, datos) =>
  USE_MOCKS ? mock.cerrarTicket(id, datos) : pedir(`/tickets/${encodeURIComponent(id)}/cerrar`, { metodo: 'POST', cuerpo: datos });

// ---------------------------------------------------------------- Usuarios, roles y permisos
export const usuarios = (q) => (USE_MOCKS ? mock.usuarios(q) : pedir(`/usuarios${consulta({ q })}`));
export const usuario = (numEmpleado) => (USE_MOCKS ? mock.usuario(numEmpleado) : pedir(`/usuarios/${encodeURIComponent(numEmpleado)}`));
export const guardarUsuario = (datos, esNuevo) =>
  USE_MOCKS
    ? mock.guardarUsuario(datos, esNuevo)
    : pedir(esNuevo ? '/usuarios' : `/usuarios/${encodeURIComponent(datos.numEmpleado)}`, { metodo: esNuevo ? 'POST' : 'PUT', cuerpo: datos });

// { roles: [{ nombre, descripcion, permisos: {pantalla: 'ver'|'acciona'}, acciones: [ids] }], pantallas: [...], acciones: [{id, nombre}] }
export const rolesPermisos = () => (USE_MOCKS ? mock.rolesPermisos() : pedir('/roles'));
export const guardarRol = (nombre, datos) =>
  USE_MOCKS ? mock.guardarRol(nombre, datos) : pedir(`/roles/${encodeURIComponent(nombre)}`, { metodo: 'PUT', cuerpo: datos });

// ---------------------------------------------------------------- Catálogos y parámetros
// { modelos: { nombre: 'Modelos', items: [{codigo, nombre, estado}] }, lineas: {...}, … }
export const catalogos = () => (USE_MOCKS ? mock.catalogos() : pedir('/catalogos'));
export const guardarElementoCatalogo = (tipo, elemento) =>
  USE_MOCKS ? mock.guardarElementoCatalogo(tipo, elemento) : pedir(`/catalogos/${encodeURIComponent(tipo)}`, { metodo: 'POST', cuerpo: elemento });
export const cambiarEstadoCatalogo = (tipo, codigo, estado) =>
  USE_MOCKS
    ? mock.cambiarEstadoCatalogo(tipo, codigo, estado)
    : pedir(`/catalogos/${encodeURIComponent(tipo)}/${encodeURIComponent(codigo)}`, { metodo: 'PATCH', cuerpo: { estado } });

// { capacidadCaja: { 'NS-MINI': 12, … }, ultimoCambio: { por, fecha, hora, motivo } }
export const parametros = () => (USE_MOCKS ? mock.parametros() : pedir('/parametros'));
export const guardarParametros = (datos) => (USE_MOCKS ? mock.guardarParametros(datos) : pedir('/parametros', { metodo: 'PUT', cuerpo: datos }));
