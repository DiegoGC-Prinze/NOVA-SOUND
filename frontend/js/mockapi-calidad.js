// Respuestas de ejemplo de CALIDAD para api.js (solo se usan con USE_MOCKS = true).
// Es la "lógica del back" fingida de las 6 pantallas de Calidad: resumen, inspección, retenciones,
// retrabajos y reportes. Cuando el back real esté listo, este archivo ya no se usa; lo que debe devolver
// el back tiene la misma forma que lo que devuelven estas funciones.
//
// Los datos de partida están en mock/calidad.json (unidades que Calidad trabaja) y se combinan con
// mock/produccion.json y mock/defectos.json para que las cifras cuadren con el Dashboard de Gerencia.
// Lo que se cambie al probar (inspecciones, retenciones resueltas…) se guarda en el navegador.

import { coleccion, guardarColeccion, leerJSON, pausa, conEscritura } from './mockdb.js';
import { ErrorApi } from './errores.js';
import { fechaRelativa, hoyISO } from './ui.js';
import { obtenerSesion } from './session.js';

// Misma acción que se asigna al rol en mock/roles-permisos.json
const ACCION_DISPOSICION = 'dar-disposicion-de-calidad-liberar-retener-retrabajo-scrap';
const CATEGORIAS = ['Funcional', 'Apariencia', 'Empaque', 'Identificación'];
const ETIQUETA = { LIBERADA: 'Liberada', EN_RETENCION: 'En retención', RETRABAJO: 'Retrabajo', SCRAP: 'Scrap' };

const suma = (filas, campo) => filas.reduce((t, f) => t + (f[campo] || 0), 0);
const ahoraHora = () => new Date().toTimeString().slice(0, 5);

async function leerUnidades() {
  return (await coleccion('calidad')).unidades;
}
const guardarUnidades = (unidades) => guardarColeccion('calidad', { unidades });

function exigirPermiso() {
  const sesion = obtenerSesion();
  if (!sesion?.acciones?.includes(ACCION_DISPOSICION)) throw new ErrorApi('No tienes permiso para dar disposición de Calidad.', 403);
  return sesion.usuario.nombre;
}

const buscarUnidad = (unidades, serie) => {
  const u = unidades.find((x) => x.serie === serie);
  if (!u) throw new ErrorApi('No se encontró la unidad.', 404);
  return u;
};

// ---------------------------------------------------------------- Cifras de un rango de días
// Base: filas de producción. Ajuste: lo que Calidad movió hoy en pantalla (unidades de hoy que cambiaron de estado).
async function cifras({ dias, turno, linea, modelo }) {
  const [prod, def, unidades] = await Promise.all([coleccion('produccion'), leerJSON('defectos'), leerUnidades()]);
  const cumple = (r) => (!turno || r.turno === Number(turno)) && (!linea || r.linea === linea) && (!modelo || r.modelo === modelo);
  const enRango = (r) => dias.includes(r.dia) && cumple(r);

  const filas = prod.filter(enRango);
  const disp = { liberadas: suma(filas, 'liberadas'), retenidas: suma(filas, 'retenidas'), retrabajo: suma(filas, 'retrabajo'), scrap: suma(filas, 'scrap') };

  const tocadas = unidades.filter((u) => dias.includes(u.dia) && cumple(u));
  const clave = { LIBERADA: 'liberadas', EMPACADA: 'liberadas', EMBARCADA: 'liberadas', EN_RETENCION: 'retenidas', RETRABAJO: 'retrabajo', SCRAP: 'scrap' };
  tocadas.forEach((u) => {
    if (u.estado !== u.estadoOriginal) {
      if (clave[u.estado]) disp[clave[u.estado]] += 1;
      if (clave[u.estadoOriginal]) disp[clave[u.estadoOriginal]] -= 1;
    }
  });

  const porDefecto = new Map();
  const sumar = (categoria, defecto, cantidad) => {
    const k = `${categoria}|${defecto}`;
    porDefecto.set(k, { categoria, defecto, cantidad: (porDefecto.get(k)?.cantidad || 0) + cantidad });
  };
  def.filter(enRango).forEach((d) => sumar(d.categoria, d.defecto, d.cantidad));
  tocadas.forEach((u) => (u.defectosNuevos || []).forEach((d) => sumar(d.categoria, d.defecto, 1)));

  const detalle = [...porDefecto.values()].sort((a, b) => b.cantidad - a.cantidad || a.defecto.localeCompare(b.defecto));
  const totalDefectos = suma(detalle, 'cantidad');
  const porCategoria = CATEGORIAS.map((categoria) => {
    const cantidad = suma(detalle.filter((d) => d.categoria === categoria), 'cantidad');
    return { categoria, cantidad, porcentaje: totalDefectos ? (cantidad / totalDefectos) * 100 : 0 };
  });
  return { disposiciones: disp, defectosPorCategoria: porCategoria, detalleDefectos: detalle.map((d) => ({ ...d, porcentaje: totalDefectos ? (d.cantidad / totalDefectos) * 100 : 0 })), totalDefectos };
}

// ---------------------------------------------------------------- Resumen de calidad
// filtros: { turno, linea }. Siempre es el día de hoy.
export async function resumenCalidad(f = {}) {
  await pausa();
  const [datos, unidades] = await Promise.all([cifras({ dias: [0], turno: f.turno, linea: f.linea }), leerUnidades()]);
  const pendientes = unidades
    .filter((u) => u.estado === 'PROBADA' && (!f.turno || u.turno === Number(f.turno)) && (!f.linea || u.linea === f.linea))
    .sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora))
    .map(({ serie, modelo, color, lote, linea, turno, hora, dia }) => ({ serie, modelo, color, lote, linea, turno, hora, fecha: fechaRelativa(-dia) }));
  return { disposiciones: datos.disposiciones, defectosPorCategoria: datos.defectosPorCategoria, pendientes };
}

// ---------------------------------------------------------------- Inspección de unidad
// defectos: [{ categoria, defecto, causa }]. disposicion: 'LIBERADA' | 'EN_RETENCION' | 'RETRABAJO' | 'SCRAP'.
// Solo se inspecciona una unidad en estado PROBADA. Para liberar no debe haber defectos; para el resto, al menos uno.
async function inspeccionar(serie, { defectos = [], observaciones = '', disposicion }) {
  await pausa(350);
  const inspector = exigirPermiso();
  const unidades = await leerUnidades();
  const u = buscarUnidad(unidades, serie);
  if (u.estado !== 'PROBADA') throw new ErrorApi('Esa unidad ya no está pendiente de inspección.', 409);
  if (!ETIQUETA[disposicion]) throw new ErrorApi('Elige la disposición de la unidad.', 400);
  if (disposicion === 'LIBERADA' && defectos.length) throw new ErrorApi('Una unidad con defectos no se puede liberar.', 400);
  if (disposicion !== 'LIBERADA' && !defectos.length) throw new ErrorApi('Registra al menos un defecto para esa disposición.', 400);

  const hora = ahoraHora();
  const nombres = defectos.map((d) => d.defecto).join(', ');
  u.estado = disposicion;
  u.defectos = defectos;
  u.defectosNuevos = [...(u.defectosNuevos || []), ...defectos];
  u.inspector = inspector;
  u.observaciones = observaciones;
  if (disposicion === 'EN_RETENCION') u.retencion = { dia: 0, hora, motivo: defectos[0].defecto, observaciones };
  if (disposicion === 'RETRABAJO') u.retrabajo = { estado: 'Pendiente', dia: 0, hora, descripcion: '', resultado: null, observaciones: '' };
  u.historial.push({ dia: 0, fecha: hoyISO(), hora, area: 'Calidad', evento: 'Inspección final', resultado: nombres ? `${ETIQUETA[disposicion]} · ${nombres}` : ETIQUETA[disposicion], usuario: inspector });
  guardarUnidades(unidades);
  return { ok: true, estado: disposicion };
}

// ---------------------------------------------------------------- Retenciones
// diaDe(u) = día en que ocurrió lo que se lista (la retención o el retrabajo), para el filtro de fecha.
function filtrarUnidades(lista, f, diaDe) {
  const q = (f.q || '').trim().toLowerCase();
  return lista.filter(
    (u) =>
      (!f.linea || u.linea === f.linea) &&
      (!f.modelo || u.modelo === f.modelo) &&
      (!q || u.serie.toLowerCase().includes(q)) &&
      (!f.fecha || fechaRelativa(-diaDe(u)) === f.fecha),
  );
}

// filtros: { q (serie), linea, modelo, fecha: 'YYYY-MM-DD' (día de la retención) }
// resumen: { retenidas, retenidasHoy } sobre TODAS las retenidas, sin filtros.
export async function retenciones(f = {}) {
  await pausa();
  const todas = (await leerUnidades()).filter((u) => u.estado === 'EN_RETENCION');
  const filas = filtrarUnidades(todas, f, (u) => u.retencion.dia)
    .sort((a, b) => a.retencion.dia - b.retencion.dia || b.retencion.hora.localeCompare(a.retencion.hora))
    .map((u) => ({
      serie: u.serie, modelo: u.modelo, color: u.color, orden: u.orden, lote: u.lote, linea: u.linea, turno: u.turno,
      fecha: fechaRelativa(-u.retencion.dia), hora: u.retencion.hora, inspector: u.inspector,
      categoria: u.defectos[0]?.categoria || '', motivo: u.retencion.motivo, observaciones: u.retencion.observaciones || u.observaciones || '',
    }));
  return { filas, resumen: { retenidas: todas.length, retenidasHoy: todas.filter((u) => u.retencion.dia === 0).length } };
}

// disposicion: 'LIBERADA' (liberar) | 'RETRABAJO' (enviar a retrabajo) | 'EN_RETENCION' (mantener) | 'SCRAP'.
// Salvo «mantener», siempre hay observaciones: queda quién, cuándo y por qué.
async function disponerRetencion(serie, { disposicion, observaciones = '' }) {
  await pausa(350);
  const inspector = exigirPermiso();
  const unidades = await leerUnidades();
  const u = buscarUnidad(unidades, serie);
  if (u.estado !== 'EN_RETENCION') throw new ErrorApi('Esa unidad ya no está en retención.', 409);
  if (!ETIQUETA[disposicion]) throw new ErrorApi('Elige qué se hará con la unidad.', 400);
  if (disposicion !== 'EN_RETENCION' && !observaciones.trim()) throw new ErrorApi('Escribe las observaciones de la disposición.', 400);

  const hora = ahoraHora();
  const texto = observaciones.trim();
  if (disposicion === 'EN_RETENCION') {
    if (texto) u.retencion.observaciones = texto;
    u.historial.push({ dia: 0, fecha: hoyISO(), hora, area: 'Calidad', evento: 'Retención revisada', resultado: texto ? `Se mantiene en retención · ${texto}` : 'Se mantiene en retención', usuario: inspector });
  } else {
    u.estado = disposicion;
    if (disposicion === 'RETRABAJO') u.retrabajo = { estado: 'Pendiente', dia: 0, hora, descripcion: '', resultado: null, observaciones: '' };
    u.historial.push({ dia: 0, fecha: hoyISO(), hora, area: 'Calidad', evento: 'Retención resuelta', resultado: `${ETIQUETA[disposicion]} · ${texto}`, usuario: inspector });
  }
  guardarUnidades(unidades);
  return { ok: true, estado: u.estado };
}

// ---------------------------------------------------------------- Retrabajos
// filtros: { q, linea, modelo, fecha (día en que se detectó), estado: 'Pendiente' | 'Finalizado' }
// resumen: { pendientes, finalizadas } sobre TODOS los retrabajos, sin filtros.
export async function retrabajos(f = {}) {
  await pausa();
  const todos = (await leerUnidades()).filter((u) => u.retrabajo);
  const filas = filtrarUnidades(todos, f, (u) => u.retrabajo.dia)
    .filter((u) => !f.estado || u.retrabajo.estado === f.estado)
    .sort((a, b) => (a.retrabajo.estado === b.retrabajo.estado ? a.retrabajo.dia - b.retrabajo.dia || b.retrabajo.hora.localeCompare(a.retrabajo.hora) : a.retrabajo.estado === 'Pendiente' ? -1 : 1))
    .map((u) => ({
      serie: u.serie, modelo: u.modelo, color: u.color, orden: u.orden, lote: u.lote, linea: u.linea, turno: u.turno,
      fecha: fechaRelativa(-u.retrabajo.dia), estado: u.retrabajo.estado,
      categoria: u.defectos[0]?.categoria || '', motivo: u.defectos[0]?.defecto || '', causa: u.defectos[0]?.causa || '',
      fechaRetrabajo: u.retrabajo.diaRetrabajo != null ? fechaRelativa(-u.retrabajo.diaRetrabajo) : null,
      descripcion: u.retrabajo.descripcion, resultado: u.retrabajo.resultado, observaciones: u.retrabajo.observaciones,
    }));
  return { filas, resumen: { pendientes: todos.filter((u) => u.retrabajo.estado === 'Pendiente').length, finalizadas: todos.filter((u) => u.retrabajo.estado === 'Finalizado').length } };
}

// resultado: 'Corregido' | 'No corregido'. Al guardar, la unidad vuelve a Calidad para una nueva inspección.
async function registrarRetrabajo(serie, { descripcion = '', resultado, observaciones = '' }) {
  await pausa(350);
  const inspector = exigirPermiso();
  const unidades = await leerUnidades();
  const u = buscarUnidad(unidades, serie);
  if (u.estado !== 'RETRABAJO' || u.retrabajo?.estado !== 'Pendiente') throw new ErrorApi('Ese retrabajo ya fue registrado.', 409);
  if (!descripcion.trim()) throw new ErrorApi('Describe el retrabajo que se hizo.', 400);
  if (!['Corregido', 'No corregido'].includes(resultado)) throw new ErrorApi('Elige el resultado del retrabajo.', 400);

  const hora = ahoraHora();
  Object.assign(u.retrabajo, { estado: 'Finalizado', diaRetrabajo: 0, horaRetrabajo: hora, descripcion: descripcion.trim(), resultado, observaciones: observaciones.trim() });
  u.estado = 'PROBADA';
  u.historial.push({ dia: 0, fecha: hoyISO(), hora, area: 'Calidad', evento: 'Retrabajo', resultado: `${resultado} · enviada a nueva inspección`, usuario: inspector });
  guardarUnidades(unidades);
  return { ok: true };
}

// ---------------------------------------------------------------- Reportes de calidad
// filtros: { desde, hasta, turno, linea, modelo }
export async function reporteCalidad(f = {}) {
  await pausa(300);
  const desde = f.desde || fechaRelativa(-6);
  const hasta = f.hasta || hoyISO();
  const dias = [];
  for (let d = 0; d <= 60; d += 1) {
    const fecha = fechaRelativa(-d);
    if (fecha >= desde && fecha <= hasta) dias.push(d);
  }
  const datos = await cifras({ dias, turno: f.turno, linea: f.linea, modelo: f.modelo });
  const d = datos.disposiciones;
  const total = d.liberadas + d.retenidas + d.retrabajo + d.scrap;
  return { desde, hasta, total, ...datos };
}

export const guardarInspeccion = (...args) => conEscritura(() => inspeccionar(...args));
export const resolverRetencion = (...args) => conEscritura(() => disponerRetencion(...args));
export const guardarRetrabajo = (...args) => conEscritura(() => registrarRetrabajo(...args));
