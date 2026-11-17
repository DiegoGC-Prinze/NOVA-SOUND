// "Base de datos" de ejemplo. Solo se usa cuando USE_MOCKS = true (js/config.js).
//
// - Los datos de partida están en la carpeta /mock (archivos .json).
// - Lo que el usuario cambia mientras prueba (nuevo ticket, usuario editado, autorización aprobada…)
//   se guarda en el navegador (localStorage) para que se conserve al cambiar de pantalla.
// - reiniciarMocks() borra esos cambios y todo vuelve a los datos de /mock.

import { leerArchivo } from './leer.js';

const PREFIJO = 'novasound.mock.';
const cacheArchivos = {};
const memoria = {}; // por si el navegador bloquea localStorage

// Lee un archivo de /mock (solo lectura).
export async function leerJSON(nombre) {
  if (!cacheArchivos[nombre]) {
    cacheArchivos[nombre] = JSON.parse(await leerArchivo(new URL(`../mock/${nombre}.json`, import.meta.url)));
  }
  return structuredClone(cacheArchivos[nombre]);
}

// Lee una colección que se puede modificar: lo guardado en el navegador o, si no hay, el archivo de /mock.
export async function coleccion(nombre) {
  let guardado = null;
  try {
    guardado = localStorage.getItem(PREFIJO + nombre);
  } catch (e) {
    guardado = memoria[nombre] ?? null;
  }
  const datos = guardado ? JSON.parse(guardado) : await leerJSON(nombre);
  // Los datos capturados conservan su fecha real al abrir la demo otro día.
  const filas = Array.isArray(datos) ? datos : datos.unidades;
  if (Array.isArray(filas)) filas.forEach(f => {
    const fecha = f.fechaRegistro || f.fecha;
    if (fecha) {
      const ahora = new Date(); ahora.setHours(12, 0, 0, 0);
      f.dia = Math.round((ahora - new Date(`${fecha}T12:00:00`)) / 86400000);
    }
  });
  // Migración única del registro de pantallas para las demos ya guardadas.
  if (nombre === 'roles-permisos' && !datos.version) {
    const almacen = datos.roles.find(r => r.nombre === 'Almacén/Empaque');
    if (almacen) for (const id of ['embarques/cierre-de-caja-escaneo', 'embarques/confirmacion-de-cierre-de-caja']) almacen.permisos[id] = 'acciona';
    datos.version = 2;
    if (guardado) guardarColeccion(nombre, datos);
  }
  return datos;
}

export function guardarColecciones(colecciones) {
  const anteriores = new Map();
  try {
    const cambios = Object.entries(colecciones).map(([nombre, datos]) => [PREFIJO + nombre, JSON.stringify(datos)]);
    cambios.forEach(([clave]) => anteriores.set(clave, localStorage.getItem(clave)));
    cambios.forEach(([clave, texto]) => localStorage.setItem(clave, texto));
  } catch (e) {
    // Evita confirmar una operación a medias si el navegador no puede guardar.
    anteriores.forEach((texto, clave) => {
      try { texto === null ? localStorage.removeItem(clave) : localStorage.setItem(clave, texto); } catch (_) { /* conservar el error original */ }
    });
    throw new Error('No se pudieron guardar los cambios en este navegador. Revisa el espacio y el permiso de almacenamiento antes de continuar.');
  }
}

export const guardarColeccion = (nombre, datos) => guardarColecciones({ [nombre]: datos });

export const conEscritura = tarea => globalThis.navigator?.locks ? navigator.locks.request('novasound.operacion', tarea) : tarea();

// Borra todo lo que se cambió durante las pruebas.
export function reiniciarMocks() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIJO))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    /* nada que borrar */
  }
  Object.keys(memoria).forEach((k) => delete memoria[k]);
}

// Simula el tiempo que tarda el servidor, para ver los estados de «cargando».
export const pausa = (ms = 250) => new Promise((resolver) => setTimeout(resolver, ms));
