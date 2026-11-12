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
  return guardado ? JSON.parse(guardado) : leerJSON(nombre);
}

export function guardarColeccion(nombre, datos) {
  const texto = JSON.stringify(datos);
  try {
    localStorage.setItem(PREFIJO + nombre, texto);
  } catch (e) {
    memoria[nombre] = texto;
  }
}

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
