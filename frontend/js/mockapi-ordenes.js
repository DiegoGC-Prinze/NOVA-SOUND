import { coleccion, guardarColeccion, conEscritura } from './mockdb.js';
import { obtenerSesion } from './session.js';
import { ErrorApi } from './errores.js';
import { hoyISO } from './ui.js';

function exigir(escribir = false) {
  const s = obtenerSesion();
  const nivel = s?.permisos?.['gerencia/ordenes-de-produccion'];
  if (!s) throw new ErrorApi('Inicia sesión para continuar.', 401);
  if (!['ver', 'acciona'].includes(nivel) || (escribir && (nivel !== 'acciona' || !s.acciones?.includes('enviar-orden-a-produccion')))) {
    throw new ErrorApi('Tu rol no tiene permiso para esta operación.', 403);
  }
}

async function datos() {
  const [catalogos, ordenes] = await Promise.all([coleccion('catalogos'), coleccion('ordenes')]);
  const opciones = tipo => catalogos[tipo].items.map((i, index) => ({ id: index + 1, nombre: i.nombre, codigo: i.codigo, estado: i.estado }))
    .filter(i => i.estado === 'Activo');
  return { fecha: hoyISO(), clientes: opciones('clientes'), modelos: opciones('modelos'), lineas: opciones('lineas'),
    colores: [...new Set(ordenes.map(o => o.color))].map((nombre, index) => ({ id: index + 1, nombre })), ordenes };
}

export async function ordenesProduccion() {
  exigir();
  return datos();
}

export async function enviarOrdenProduccion(p) {
  exigir(true);
  return conEscritura(async () => {
    const d = await datos();
    const buscar = (tipo, id) => {
      const item = d[tipo].find(i => i.id === id);
      if (!item) throw new ErrorApi('Selecciona un elemento activo de cada catálogo.', 422);
      return item;
    };
    const cliente = buscar('clientes', p.id_cliente), modelo = buscar('modelos', p.id_modelo);
    const color = buscar('colores', p.id_color), linea = buscar('lineas', p.id_linea);
    if (!Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 2147483647) throw new ErrorApi('Escribe una cantidad entera mayor que cero.', 422);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_compromiso) || !Number.isFinite(Date.parse(p.fecha_compromiso)) || p.fecha_compromiso < d.fecha) {
      throw new ErrorApi('La fecha de compromiso debe ser hoy o una fecha posterior.', 422);
    }
    const numero = Math.max(0, ...d.ordenes.map(o => Number(String(o.id).replace(/^OP-/, '')) || 0)) + 1;
    const orden = { id: `OP-${numero}`, cliente: cliente.nombre, modelo: modelo.nombre, color: color.nombre,
      linea: linea.codigo, cantidad: p.cantidad, fecha_compromiso: p.fecha_compromiso, producidas: 0,
      compromisoEnDias: Math.round((Date.parse(p.fecha_compromiso) - Date.parse(d.fecha)) / 86400000),
      cajas: { preparadas: 0, pendientes: 0, embarcadas: 0 } };
    d.ordenes.push(orden);
    guardarColeccion('ordenes', d.ordenes);
    return orden;
  });
}
