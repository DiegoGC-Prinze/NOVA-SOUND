/**
 * NOVA SOUND — cliente HTTP independiente del framework para Empaque y Embarques.
 * Para sesiones definitivas se exige middleware de autenticación del equipo.
 * Base relativa por defecto: configurar proxy /api -> FastAPI o servir mismo origen.
 * No incluye credenciales, contraseñas ni cabeceras de suplantación.
 */
export class AlmacenApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = 'AlmacenApiError';
    this.status = status;
    this.detail = detail;
  }
}

export function createAlmacenApi({
  baseURL = '/api/v1/almacen',
  fetchImpl = globalThis.fetch,
  credentials = 'include',
  obtenerToken = () => null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch no disponible');
  const base = String(baseURL).replace(/\/$/, '');

  const url = (path, params) => {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') qs.set(key, String(value));
    });
    const query = qs.toString();
    return `${base}${path}${query ? `?${query}` : ''}`;
  };
  async function request(method, path, { params, body } = {}) {
    const options = {
      method,
      credentials,
      headers: { Accept: 'application/json' },
    };
    const token = obtenerToken();
    if (token) options.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchImpl(url(path, params), options);
    } catch (e) {
      throw new AlmacenApiError(0, 'No se pudo conectar a FastAPI', e);
    }
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) {
      const detalle = data?.detail ?? data ?? `HTTP ${response.status}`;
      const mensaje = Array.isArray(detalle) ? detalle.map(e => e.msg || JSON.stringify(e)).join('; ') : typeof detalle === 'string' ? detalle : JSON.stringify(detalle);
      throw new AlmacenApiError(response.status, mensaje, detalle);
    }
    return data;
  }
  const numero = (value) => encodeURIComponent(String(value));
  return {
    // Pantalla: Panel de Empaque y consulta de cajas
    panel: () => request('GET', '/panel'),
    ordenes: () => request('GET', '/ordenes'),
    disponibles: (idOrden, buscar = '', limite = 50, desplazamiento = 0) =>
      request('GET', '/unidades-disponibles', { params: { id_orden: idOrden, buscar, limite, desplazamiento } }),
    cajas: (filtros = {}) => request('GET', '/cajas', { params: filtros }),
    caja: (idCaja) => request('GET', `/cajas/${numero(idCaja)}`),
    formarCaja: (idOrden) => request('POST', '/cajas', { body: { id_orden: idOrden } }),
    agregarUnidad: (idCaja, serie) => request('POST', `/cajas/${numero(idCaja)}/unidades`,
      { body: { numero_serie: serie } }),
    retirarUnidad: (idCaja, idUnidad) => request('DELETE', `/cajas/${numero(idCaja)}/unidades/${numero(idUnidad)}`),
    cerrarCaja: (idCaja, motivo = '') => request('POST', `/cajas/${numero(idCaja)}/cerrar`, { body: { motivo } }),
    historialCaja: (idCaja) => request('GET', `/cajas/${numero(idCaja)}/historial`),
    solicitarReapertura: (idCaja, motivo) => request('POST', `/cajas/${numero(idCaja)}/solicitudes-reapertura`,
      { body: { motivo } }),
    solicitudesReapertura: (idCaja) => request('GET', `/cajas/${numero(idCaja)}/solicitudes-reapertura`),
    reabrirCaja: (idCaja, idAutorizacion) => request('POST', `/cajas/${numero(idCaja)}/reabrir`,
      { body: { id_autorizacion: idAutorizacion } }),
    // Pantallas de Will: Embarques, Armar embarque, Estado de embarque
    embarques: () => request('GET', '/embarques'),
    embarque: (id) => request('GET', `/embarques/${numero(id)}`),
    crearEmbarque: (idOrden, referencia, datos = {}) => request('POST', '/embarques',
      { body: { id_orden: idOrden, referencia, destino: datos.destino, contenedor: datos.contenedor } }),
    agregarCajaEmbarque: (idEmbarque, idCaja) => request('POST',
      `/embarques/${numero(idEmbarque)}/cajas/${numero(idCaja)}`),
    quitarCajaEmbarque: (idEmbarque, idCaja) => request('DELETE',
      `/embarques/${numero(idEmbarque)}/cajas/${numero(idCaja)}`),
    registrarSalida: (idEmbarque) => request('POST', `/embarques/${numero(idEmbarque)}/salida`),
    historialEmbarque: (idEmbarque) => request('GET', `/embarques/${numero(idEmbarque)}/historial`),
    // Reportes y seguimiento
    reporteEmpaque: (desde = undefined, hasta = undefined) =>
      request('GET', '/reportes/empaque', { params: { desde, hasta } }),
    incidencias: () => request('GET', '/reportes/incidencias'),
    registrarIncidencia: (idCaja, tipo, motivo) => request('POST',
      `/cajas/${numero(idCaja)}/incidencias`, { body: { tipo, motivo } }),
    trazabilidad: (serie) => request('GET', `/trazabilidad/${numero(serie)}`),
  };
}
