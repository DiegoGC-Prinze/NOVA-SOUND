// Traduce los contratos PostgreSQL a las vistas existentes. Nunca recurre a mocks.
import { createAlmacenApi, AlmacenApiError } from '../integraciones/almacenApi.mjs';
import { obtenerSesion, cerrarSesion } from './session.js';
import { ErrorApi } from './errores.js';

const api = createAlmacenApi({ obtenerToken: () => obtenerSesion()?.token });
const id = value => {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new ErrorApi('Selecciona un registro válido de PostgreSQL.', 422);
  return Number(value);
};
const estadoCaja = { EN_PROCESO: 'Abierta', CERRADA: 'Cerrada', EMBARCADA: 'Embarcada' };
const estadoEmbarque = { PREPARACION: 'Preparando', ENVIADO: 'Enviado' };
const dia = value => value?.slice(0, 10) || '';
const auditoria = eventos => eventos.map(e => ({ fecha: dia(e.fecha_hora), hora: e.fecha_hora?.slice(11, 16) || '', quien: `Usuario ${e.id_usuario}`, que: e.accion, motivo: e.motivo || '' }));
const orden = o => ({ ...o, id: String(o.id_orden), idColor: o.id_color, mezclaColores: o.mezcla_colores });
const caja = (b, ordenes) => {
  const o = ordenes.find(o => o.id === String(b.id_orden));
  return { id: String(b.id_caja), orden: b.id_orden == null ? '' : String(b.id_orden), cliente: b.cliente, modelo: b.modelo,
    color: o?.color || '', idColor: o?.idColor, mezclaColores: o?.mezclaColores || false,
    estado: estadoCaja[b.estado] || `Heredada (${b.estado || 'sin estado'})`, capacidad: b.capacidad,
    cantidad: b.cantidad_unidades, unidades: (b.unidades || []).map(u => u.numero_serie).filter(Boolean),
    embarque: b.id_embarque == null ? null : String(b.id_embarque), fecha: dia(b.fecha_creacion), auditoria: [] };
};
const embarque = e => ({ id: String(e.id_embarque), orden: String(e.id_orden), cliente: e.cliente,
  referencia: e.referencia, destino: e.destino || '', contenedor: e.contenedor || e.referencia || '',
  estado: estadoEmbarque[e.estado] || e.estado, cantidadCajas: e.cantidad_cajas,
  cajas: (e.cajas || []).map(b => String(b.id_caja)), fecha: dia(e.fecha_creacion), fechaSalida: dia(e.fecha_salida), auditoria: [] });
const unidad = (u, ordenes) => {
  const o = ordenes.find(o => o.id === String(u.id_orden));
  return { id: u.id_unidad, serie: u.numero_serie, orden: String(u.id_orden), modelo: o?.modelo || '',
    cliente: o?.cliente || '', color: u.color, idColor: u.id_color, estado: u.estado,
    caja: u.id_caja == null ? null : { id: String(u.id_caja) } };
};
async function proteger(tarea) {
  try { return await tarea(); }
  catch (e) {
    if (e instanceof AlmacenApiError) {
      if (e.status === 401) { await cerrarSesion(); location.replace(new URL('../index.html', import.meta.url)); }
      throw new ErrorApi(e.message, e.status);
    }
    throw e;
  }
}

export const consultarAlmacen = (contexto = {}) => proteger(async () => {
  const [os, bs, es, panel] = await Promise.all([api.ordenes(), api.cajas(), api.embarques(), api.panel()]);
  const ordenes = os.map(orden), cajas = bs.map(b => caja(b, ordenes)), embarques = es.map(embarque);
  const unidades = new Map();
  let solicitudes = [];
  const d = { real: true, fuente: 'PostgreSQL', ordenes, cajas, embarques, panel, unidades: [], solicitudes,
    parametros: { capacidadCaja: Object.fromEntries(os.filter(o => o.capacidad_caja).map(o => [o.modelo, o.capacidad_caja])) } };
  if (contexto.caja) {
    const numero = id(contexto.caja);
    const [detalle, eventos, pendientes] = await Promise.all([api.caja(numero), api.historialCaja(numero), api.solicitudesReapertura(numero)]);
    const normalizada = caja(detalle, ordenes); normalizada.auditoria = auditoria(eventos);
    const indice = cajas.findIndex(b => b.id === normalizada.id);
    if (indice < 0) cajas.push(normalizada); else cajas[indice] = normalizada;
    detalle.unidades.forEach(u => unidades.set(u.id_unidad, unidad(u, ordenes)));
    d.solicitudes = pendientes;
    if (normalizada.orden && normalizada.estado === 'Abierta') {
      for (let offset = 0; ; offset += 100) {
        const disponibles = await api.disponibles(id(normalizada.orden), '', 100, offset);
        disponibles.forEach(u => unidades.set(u.id_unidad, unidad(u, ordenes)));
        if (disponibles.length < 100) break;
      }
    }
  }
  if (contexto.embarque) {
    const numero = id(contexto.embarque);
    const [detalle, eventos] = await Promise.all([api.embarque(numero), api.historialEmbarque(numero)]);
    const normalizado = embarque(detalle); normalizado.auditoria = auditoria(eventos);
    const indice = embarques.findIndex(e => e.id === normalizado.id);
    if (indice < 0) embarques.push(normalizado); else embarques[indice] = normalizado;
  }
  d.unidades = [...unidades.values()];
  return d;
});

export const operarAlmacen = (accion, p = {}) => proteger(async () => {
  let r;
  switch (accion) {
    case 'crearCaja': r = await api.formarCaja(id(p.orden)); return { id: String(r.id_caja) };
    case 'agregarUnidad': return api.agregarUnidad(id(p.caja), p.serie);
    case 'quitarUnidad': {
      const b = await api.caja(id(p.caja));
      const u = b.unidades.find(u => u.numero_serie === p.serie);
      if (!u) throw new ErrorApi('La unidad ya no está en la caja. Actualiza la pantalla.', 409);
      return api.retirarUnidad(id(p.caja), u.id_unidad);
    }
    case 'cerrarCaja': return api.cerrarCaja(id(p.caja), p.motivo);
    case 'solicitarReapertura': return api.solicitarReapertura(id(p.caja), p.motivo);
    case 'reabrirCaja': return api.reabrirCaja(id(p.caja), id(p.autorizacion));
    case 'crearEmbarque':
      if (!p.destino?.trim()) throw new ErrorApi('Escribe el destino del embarque.', 422);
      r = await api.crearEmbarque(id(p.orden), p.contenedor || `ENVIO-${crypto.randomUUID().slice(0, 8)}`, { destino: p.destino, contenedor: p.contenedor });
      return { id: String(r.id_embarque) };
    case 'asignarCaja': return api.agregarCajaEmbarque(id(p.embarque), id(p.caja));
    case 'quitarCaja': return api.quitarCajaEmbarque(id(p.embarque), id(p.caja));
    case 'confirmarSalida': return api.registrarSalida(id(p.embarque));
    default: throw new ErrorApi('Esta operación no está disponible para Almacén.', 422);
  }
});
