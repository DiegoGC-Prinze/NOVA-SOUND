// Fragmentos para incorporar en los componentes existentes del Frontend.
// No se ejecutan automáticamente: requieren una sesión autenticada válida.
import { createAlmacenApi, AlmacenApiError } from './almacenApi.mjs';

export const almacen = createAlmacenApi();

export async function mostrarPanel() {
  const [panel, cajas] = await Promise.all([almacen.panel(), almacen.cajas()]);
  return { panel, cajas };
}

export async function escanearEnCaja(idOrden, serie, cajaIdActual = null) {
  const caja = cajaIdActual ? await almacen.caja(cajaIdActual) : await almacen.formarCaja(idOrden);
  return almacen.agregarUnidad(caja.id_caja, serie);
}

export async function cerrarYEmbarcar(idCaja, idOrden, referencia) {
  await almacen.cerrarCaja(idCaja);
  const embarque = await almacen.crearEmbarque(idOrden, referencia);
  await almacen.agregarCajaEmbarque(embarque.id_embarque, idCaja);
  return almacen.registrarSalida(embarque.id_embarque);
}

export async function errorVisible(e) {
  if (!(e instanceof AlmacenApiError)) throw e;
  if (e.status === 401) return 'Inicia sesión para continuar';
  if (e.status === 403) return 'Tu usuario no tiene permisos de Almacén';
  if (e.status === 404) return 'Recurso o serie no encontrado';
  if (e.status === 409) return `La operación está bloqueada: ${e.message}`;
  if (e.status === 422) return 'Revisa los campos del formulario';
  if (e.status === 503) return 'No hay conexión con PostgreSQL';
  return e.message;
}
