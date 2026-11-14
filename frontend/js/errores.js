// Error que lanzan las funciones de api.js. `estado` es el código HTTP (401, 403, 404…) o 0 si no hubo conexión.
export class ErrorApi extends Error {
  constructor(mensaje, estado = 0) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
  }
}
