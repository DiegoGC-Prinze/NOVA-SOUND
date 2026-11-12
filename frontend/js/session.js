// Guarda quién entró, con qué rol y en qué turno.
// Usa sessionStorage: se borra al cerrar la pestaña. Si el navegador lo bloquea,
// no se podrá mantener la sesión entre pantallas (por eso van en try/catch).

const CLAVE = 'novasound.sesion';

export function guardarSesion(sesion) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
  } catch (e) {
    /* sin almacenamiento disponible */
  }
}

export function obtenerSesion() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE));
  } catch (e) {
    return null;
  }
}

export function cerrarSesion() {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch (e) {
    /* nada que borrar */
  }
}
