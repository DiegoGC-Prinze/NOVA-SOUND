// Operación de la demo: las áreas comparten unidades, cajas e historial.
// Las escrituras se serializan también entre pestañas del mismo navegador.
import { coleccion, guardarColecciones, leerJSON, conEscritura } from './mockdb.js';
import { obtenerSesion } from './session.js';
import { ErrorApi } from './errores.js';
import { hoyISO, fechaRelativa } from './ui.js';

const hora = () => new Date().toTimeString().slice(0, 5);
const texto = v => String(v ?? '').trim();
const codigo = v => texto(v).toUpperCase();
const error = (mensaje, estado = 400) => { throw new ErrorApi(mensaje, estado); };
const entero = (v, minimo = 0) => Number.isInteger(Number(v)) && texto(v) !== '' && Number(v) >= minimo;
const buscar = (filas, id, campo = 'id') => filas.find(f => f[campo] === id) || error('No se encontró el registro.', 404);
const usuario = () => obtenerSesion()?.usuario || error('Inicia sesión para continuar.', 401);
const fecha = registro => registro.fechaRegistro || registro.fecha || hoyISO();
const idNuevo = prefijo => `${prefijo}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

function exigir(pantallas, accion) {
  const s = obtenerSesion();
  if (!s) error('Inicia sesión para continuar.', 401);
  if (![pantallas].flat().some(p => s.permisos?.[p] === 'acciona') || (accion && !s.acciones?.includes(accion))) {
    error('No tienes permiso para realizar esta operación.', 403);
  }
  return s.usuario;
}

function evento(u, area, descripcion, resultado) {
  u.historial ||= [];
  u.historial.push({ dia: 0, fecha: hoyISO(), hora: hora(), area, evento: descripcion, resultado, usuario: usuario().nombre });
}
function auditoria(registro, que, motivo = '') {
  registro.auditoria ||= [];
  registro.auditoria.push({ fecha: hoyISO(), hora: hora(), quien: usuario().nombre, que, motivo });
}

async function cargar() {
  const [calidad, base, op, ordenes, parametros, produccion, autorizaciones, catalogos] = await Promise.all([
    coleccion('calidad'), leerJSON('unidades'), coleccion('operacion'), coleccion('ordenes'),
    coleccion('parametros'), coleccion('produccion'), coleccion('autorizaciones'), coleccion('catalogos'),
  ]);
  const series = new Set(calidad.unidades.map(u => u.serie));
  const unidades = [...calidad.unidades, ...base.filter(u => !series.has(u.serie))];
  unidades.forEach(u => { u.estadoOriginal ||= u.estado; u.defectos ||= []; });
  return { unidades, op, ordenes, parametros, produccion, autorizaciones, catalogos };
}

function guardar(d) {
  guardarColecciones({ calidad: { unidades: d.unidades }, produccion: d.produccion, autorizaciones: d.autorizaciones, operacion: d.op });
}

export async function consultarOperacion() {
  usuario();
  const d = await cargar();
  return { ...d.op, unidades: d.unidades, ordenes: d.ordenes, parametros: d.parametros,
    autorizaciones: d.autorizaciones, catalogos: d.catalogos, resumen: await metricasProduccion(d) };
}

// Los datos históricos son agregados; las unidades creadas en la demo aportan
// sus cambios de estado a esos mismos indicadores, sin inventar series históricas.
export async function metricasProduccion(datos) {
  const d = datos || await cargar();
  const filas = structuredClone(d.produccion);
  const contadores = estado => ({
    liberadas: ['LIBERADA', 'EMPACADA', 'EMBARCADA'].includes(estado) ? 1 : 0,
    recibidas: ['EMPACADA', 'EMBARCADA'].includes(estado) ? 1 : 0,
    retenidas: estado === 'EN_RETENCION' ? 1 : 0,
    retrabajo: estado === 'RETRABAJO' ? 1 : 0,
    scrap: estado === 'SCRAP' ? 1 : 0,
  });
  for (const u of d.unidades) {
    if (!u.estadoOriginal || u.estado === u.estadoOriginal) continue;
    let f = filas.find(r => r.orden === u.orden && r.linea === u.linea && Number(r.turno) === Number(u.turno) && r.dia === u.dia);
    if (!f) { f = { dia: u.dia, turno: u.turno, linea: u.linea, modelo: u.modelo, orden: u.orden, lote: u.lote, meta: 0, reportadas: 0, liberadas: 0, recibidas: 0, retenidas: 0, retrabajo: 0, scrap: 0 }; filas.push(f); }
    const antes = contadores(u.estadoOriginal), despues = contadores(u.estado);
    Object.keys(antes).forEach(k => { f[k] = (f[k] || 0) + despues[k] - antes[k]; });
  }
  return filas;
}

const cierreActual = (d, linea, turno, fechaCierre = hoyISO()) => d.op.cierres.find(c => c.fecha === fechaCierre && c.linea === linea && c.turno === Number(turno) && c.estado === 'Cerrado');
const puedeEmpacar = u => u.estado === 'LIBERADA' && !u.caja;
const permisoCaja = () => exigir('empaque/formar-caja', 'cerrar-caja');
const permisoEmbarque = () => exigir('embarques/armar-embarque', 'confirmar-salida-de-embarque');
const pendientes = ['encendido', 'audio', 'carga', 'bluetooth'];

const operaciones = {
  registrarUnidad(d, p) {
    exigir('produccion/registrar-produccion', 'registrar-produccion');
    const serie = codigo(p.serie), lote = codigo(p.lote), orden = buscar(d.ordenes, p.orden);
    if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(serie)) error('Ingresa una serie de 3 a 80 caracteres: letras, números, guion o guion bajo.');
    if (d.unidades.some(u => codigo(u.serie) === serie)) error('Ese número de serie ya está registrado.', 409);
    if (!lote) error('Ingresa el lote.');
    if (!entero(p.turno, 1) || ![1, 2].includes(Number(p.turno))) error('Elige un turno válido.');
    const activo = (tipo, valor) => d.catalogos[tipo].items.some(i => i.codigo === valor && i.estado === 'Activo');
    if (!activo('modelos', orden.modelo) || !activo('lineas', orden.linea) || !activo('turnos', `T${p.turno}`)) error('El modelo, la línea o el turno están inactivos en Catálogos.');
    if (cierreActual(d, orden.linea, p.turno)) error('Ese turno está cerrado. Solicita y autoriza su reapertura antes de registrar unidades.', 409);
    const u = { serie, lote, orden: orden.id, cliente: orden.cliente, modelo: orden.modelo, color: orden.color,
      linea: orden.linea, turno: Number(p.turno), dia: 0, fechaRegistro: hoyISO(), hora: hora(), nueva: true,
      estado: 'ENSAMBLADA', estadoOriginal: 'ENSAMBLADA', prueba: {}, defectos: [], historial: [], caja: null, embarque: null };
    evento(u, 'Producción', 'Unidad ensamblada', 'Pendiente de prueba funcional');
    d.unidades.push(u);
    let f = d.produccion.find(r => r.fecha === hoyISO() && r.orden === orden.id && r.turno === u.turno && r.lote === lote);
    if (!f) { f = { fecha: hoyISO(), dia: 0, linea: u.linea, turno: u.turno, modelo: u.modelo, orden: u.orden, lote, meta: 0, reportadas: 0, liberadas: 0, recibidas: 0, retenidas: 0, retrabajo: 0, scrap: 0 }; d.produccion.push(f); }
    f.reportadas++;
    return u;
  },
  guardarPrueba(d, p) {
    exigir('prueba-funcional/registro-de-pruebas-funcionales', 'registrar-resultado-de-prueba-funcional');
    const u = buscar(d.unidades, codigo(p.serie), 'serie');
    if (!['ENSAMBLADA', 'FALLA_FUNCIONAL'].includes(u.estado)) error('La unidad ya fue probada o no está disponible para prueba funcional.', 409);
    if (!pendientes.every(k => ['Aprobada', 'Falla'].includes(p.prueba?.[k]))) error('Evalúa las cuatro pruebas antes de guardar.');
    const falla = pendientes.some(k => p.prueba[k] === 'Falla');
    if (falla && !texto(p.observaciones)) error('Escribe el motivo de la falla en Observaciones.');
    u.prueba = structuredClone(p.prueba);
    u.estado = falla ? 'FALLA_FUNCIONAL' : 'PROBADA';
    const registro = { id: idNuevo('PF'), serie: u.serie, lote: u.lote, modelo: u.modelo, linea: u.linea,
      fecha: hoyISO(), hora: hora(), usuario: usuario().nombre, resultado: falla ? 'Rechazada' : 'Aprobada', prueba: u.prueba, observaciones: texto(p.observaciones) };
    d.op.pruebas.push(registro);
    evento(u, 'Prueba funcional', 'Prueba funcional', falla ? `Falla · ${registro.observaciones}` : 'Aprobada · pendiente de inspección de Calidad');
    return registro;
  },
  registrarIncidencia(d, p) {
    exigir('produccion/registrar-incidencia');
    if (!texto(p.motivo)) error('Describe el motivo de la incidencia.');
    if (!d.catalogos.lineas.items.some(l => l.codigo === p.linea)) error('Elige una línea válida.');
    if (!entero(p.paro)) error('El tiempo de paro debe ser un entero mayor o igual que cero.');
    const r = { ...p, motivo: texto(p.motivo), paro: Number(p.paro), id: idNuevo('INC'), fecha: hoyISO(), hora: hora(), usuario: usuario().nombre, estado: 'Abierta' };
    d.op.incidencias.push(r); return r;
  },
  cerrarTurno(d, p) {
    exigir('produccion/cierre-de-turno', 'guardar-cierre-de-turno');
    if (!texto(p.motivo)) error('Escribe la nota de cierre.');
    if (!d.catalogos.lineas.items.some(l => l.codigo === p.linea) || ![1, 2].includes(Number(p.turno))) error('Elige línea y turno válidos.');
    if (cierreActual(d, p.linea, p.turno)) error('El turno ya está cerrado.', 409);
    const c = { id: idNuevo('CT'), fecha: hoyISO(), linea: p.linea, turno: Number(p.turno), estado: 'Cerrado', nota: texto(p.motivo), usuario: usuario().nombre, hora: hora() };
    auditoria(c, 'Cierre de turno', c.nota); d.op.cierres.push(c); return c;
  },
  solicitarAjuste(d, p) {
    exigir('produccion/solicitar-ajuste', 'solicitar-ajuste-de-produccion-o-de-cierre');
    const orden = buscar(d.ordenes, p.orden);
    if (!texto(p.motivo)) error('Escribe el motivo de la solicitud.');
    if (![1, 2].includes(Number(p.turno))) error('Elige un turno válido.');
    const reapertura = p.tipo === 'Reapertura de turno';
    const actual = d.produccion.filter(r => r.dia === 0 && r.orden === orden.id && r.turno === Number(p.turno)).reduce((s, r) => s + r.reportadas, 0);
    if (reapertura && !cierreActual(d, orden.linea, p.turno)) error('No hay un cierre vigente para reabrir.');
    if (!reapertura && (!entero(p.nuevo) || Number(p.nuevo) === actual)) error('El valor corregido debe ser un entero distinto del conteo actual.');
    const a = { id: idNuevo('AJ'), tipo: reapertura ? p.tipo : 'Corrección de cierre', orden: orden.id, linea: orden.linea, turno: Number(p.turno), dia: 0, fechaRegistro: hoyISO(), hora: hora(),
      solicita: { nombre: usuario().nombre, rol: usuario().rol, numEmpleado: usuario().numEmpleado },
      cambio: reapertura ? null : { campo: 'Reportadas', de: actual, a: Number(p.nuevo) }, motivo: texto(p.motivo), estado: 'Pendiente', operacion: true };
    d.autorizaciones.push(a); return a;
  },
  crearCaja(d, p) {
    permisoCaja(); const o = buscar(d.ordenes, p.orden);
    const cap = Number(d.parametros.capacidadCaja[o.modelo]);
    if (!entero(cap, 1)) error('Configura una capacidad válida en Sistemas.');
    const c = { id: idNuevo('CX'), orden: o.id, cliente: o.cliente, modelo: o.modelo, color: o.color,
      estado: 'Abierta', capacidad: cap, unidades: [], fecha: hoyISO(), hora: hora(), embarque: null, auditoria: [] };
    auditoria(c, 'Caja creada'); d.op.cajas.push(c); return c;
  },
  agregarUnidad(d, p) {
    permisoCaja(); const c = buscar(d.op.cajas, p.caja), u = buscar(d.unidades, codigo(p.serie), 'serie');
    if (c.estado !== 'Abierta' || c.embarque) error('La caja ya no admite cambios.', 409);
    if (!puedeEmpacar(u)) error('Solo se pueden empacar unidades liberadas y sin caja.', 409);
    if (u.orden !== c.orden || u.modelo !== c.modelo || u.cliente !== c.cliente || u.color !== c.color) error('La unidad debe coincidir con la orden, modelo, cliente y color de la caja.');
    c.capacidad = Number(d.parametros.capacidadCaja[c.modelo]);
    if (c.unidades.length >= c.capacidad) error('La caja ya alcanzó su capacidad.');
    c.unidades.push(u.serie); u.estado = 'EMPACADA';
    auditoria(c, `Unidad agregada: ${u.serie}`); sincronizarCaja(d, c);
    evento(u, 'Empaque', `Agregada a la caja ${c.id}`, 'Empacada'); return c;
  },
  quitarUnidad(d, p) {
    permisoCaja(); const c = buscar(d.op.cajas, p.caja);
    if (c.estado !== 'Abierta' || c.embarque) error('Solo puedes quitar unidades de una caja abierta.', 409);
    if (!c.unidades.includes(p.serie)) error('La unidad no está en esa caja.');
    c.unidades = c.unidades.filter(s => s !== p.serie);
    const u = buscar(d.unidades, p.serie, 'serie'); u.caja = null; u.estado = 'LIBERADA';
    evento(u, 'Empaque', `Retirada de ${c.id}`, 'Liberada'); auditoria(c, `Unidad retirada: ${u.serie}`); sincronizarCaja(d, c); return c;
  },
  cerrarCaja(d, p) {
    exigir(['empaque/formar-caja', 'empaque/confirmar-cierre-de-caja', 'embarques/cierre-de-caja-escaneo', 'embarques/confirmacion-de-cierre-de-caja'], 'cerrar-caja');
    const c = buscar(d.op.cajas, p.caja);
    if (c.estado !== 'Abierta') error('La caja ya está cerrada.', 409);
    c.capacidad = Number(d.parametros.capacidadCaja[c.modelo]);
    if (!c.unidades.length || c.unidades.length > c.capacidad) error('La caja debe contener unidades y respetar la capacidad configurada.');
    if (!p.validado) error('Confirma las validaciones para cerrar la caja.');
    if (c.unidades.length < c.capacidad && !texto(p.motivo)) error('Explica el motivo para cerrar una caja incompleta.');
    if (c.unidades.some(s => buscar(d.unidades, s, 'serie').estado !== 'EMPACADA')) error('Hay unidades no disponibles en la caja.', 409);
    c.estado = 'Cerrada'; c.fechaCierre = hoyISO();
    auditoria(c, 'Caja cerrada', texto(p.motivo)); sincronizarCaja(d, c);
    c.unidades.forEach(s => evento(buscar(d.unidades, s, 'serie'), 'Empaque', `Caja ${c.id} cerrada`, `${c.unidades.length} de ${c.capacidad} · ${texto(p.motivo)}`)); return c;
  },
  reabrirCaja(d, p) {
    exigir('empaque/consultar-caja', 'reabrir-caja'); const c = buscar(d.op.cajas, p.caja);
    if (c.estado !== 'Cerrada' || c.embarque) error('Solo se puede reabrir una caja cerrada que no esté asignada a un embarque.', 409);
    if (!texto(p.motivo)) error('Escribe el motivo de reapertura.');
    c.estado = 'Abierta'; auditoria(c, 'Caja reabierta', texto(p.motivo)); sincronizarCaja(d, c);
    c.unidades.forEach(s => evento(buscar(d.unidades, s, 'serie'), 'Empaque', `Caja ${c.id} reabierta`, texto(p.motivo))); return c;
  },
  crearEmbarque(d, p) {
    permisoEmbarque(); if (!texto(p.destino)) error('Escribe el destino del embarque.');
    const o = buscar(d.ordenes, p.orden);
    const e = { id: idNuevo('EMB'), orden: o.id, cliente: o.cliente, destino: texto(p.destino), contenedor: codigo(p.contenedor), estado: 'Preparando', cajas: [], fecha: hoyISO(), hora: hora(), auditoria: [] };
    auditoria(e, 'Embarque creado'); d.op.embarques.push(e); return e;
  },
  asignarCaja(d, p) {
    permisoEmbarque(); const e = buscar(d.op.embarques, p.embarque), c = buscar(d.op.cajas, p.caja);
    if (e.estado !== 'Preparando' || c.estado !== 'Cerrada' || c.embarque) error('El embarque debe estar preparando y la caja cerrada y sin asignar.', 409);
    if (c.orden !== e.orden || c.cliente !== e.cliente) error('La caja debe pertenecer a la misma orden y cliente del embarque.');
    e.cajas.push(c.id); c.embarque = e.id; auditoria(c, `Asignada a ${e.id}`); auditoria(e, `Caja asignada: ${c.id}`);
    c.unidades.forEach(s => evento(buscar(d.unidades, s, 'serie'), 'Embarques', `Asignada a ${e.id}`, 'Preparando salida')); return e;
  },
  quitarCaja(d, p) {
    permisoEmbarque(); const e = buscar(d.op.embarques, p.embarque), c = buscar(d.op.cajas, p.caja);
    if (e.estado !== 'Preparando' || c.embarque !== e.id) error('No se puede retirar esa caja del embarque.', 409);
    e.cajas = e.cajas.filter(id => id !== c.id); c.embarque = null; auditoria(c, `Retirada de ${e.id}`); auditoria(e, `Caja retirada: ${c.id}`);
    c.unidades.forEach(s => evento(buscar(d.unidades, s, 'serie'), 'Embarques', `Retirada de ${e.id}`, 'Pendiente de embarque')); return e;
  },
  confirmarSalida(d, p) {
    permisoEmbarque(); const e = buscar(d.op.embarques, p.embarque);
    if (e.estado !== 'Preparando' || !e.cajas.length) error('El embarque debe estar preparando y contener al menos una caja cerrada.', 409);
    for (const id of e.cajas) {
      const c = buscar(d.op.cajas, id);
      if (c.estado !== 'Cerrada' || c.embarque !== e.id || c.unidades.some(s => buscar(d.unidades, s, 'serie').estado !== 'EMPACADA')) error('Revisa el estado de las cajas y sus unidades antes de registrar la salida.', 409);
    }
    e.estado = 'Enviado'; e.fechaSalida = hoyISO(); e.horaSalida = hora(); auditoria(e, 'Salida confirmada');
    for (const id of e.cajas) {
      const c = buscar(d.op.cajas, id); c.estado = 'Embarcada'; auditoria(c, `Salida en ${e.id}`); sincronizarCaja(d, c);
      for (const s of c.unidades) {
        const u = buscar(d.unidades, s, 'serie'); u.estado = 'EMBARCADA'; u.embarque = { referencia: e.id, cliente: e.cliente, destino: e.destino, contenedor: e.contenedor, fechaSalida: e.fechaSalida, fechaSalidaDias: 0 };
        evento(u, 'Embarques', `Salida de ${e.id}`, `Embarcada · ${e.destino}`);
      }
    }
    return e;
  },
};

function sincronizarCaja(d, c) {
  for (const s of c.unidades) buscar(d.unidades, s, 'serie').caja = { id: c.id, estado: c.estado, capacidad: c.capacidad, unidades: [...c.unidades] };
}

export async function operar(accion, datos = {}) {
  if (!Object.hasOwn(operaciones, accion)) error('Operación desconocida.');
  const ejecutar = async () => { const d = await cargar(); const resultado = operaciones[accion](d, datos); guardar(d); return structuredClone(resultado); };
  return conEscritura(ejecutar);
}

// La resolución de Gerencia aplica también la corrección o reapertura solicitada.
export async function resolverSolicitud(id, { decision, motivo = '' }) {
  const ejecutar = async () => {
    exigir('gerencia/autorizaciones', 'aprobar-o-rechazar-ajustes-y-reaperturas');
    const d = await cargar(), a = buscar(d.autorizaciones, id);
    if (a.estado !== 'Pendiente') error('Esa solicitud ya fue resuelta.', 409);
    if (!['aprobar', 'rechazar'].includes(decision)) error('Elige aprobar o rechazar.');
    if (decision === 'rechazar' && !texto(motivo)) error('Escribe el motivo del rechazo.');
    if (a.solicita.numEmpleado === usuario().numEmpleado) error('Otra persona debe autorizar tu solicitud.', 403);
    if (a.operacion && decision === 'aprobar') {
      if (a.tipo === 'Reapertura de turno') {
        const c = cierreActual(d, a.linea, a.turno, fecha(a));
        if (!c) error('El turno ya no está cerrado.', 409);
        c.estado = 'Reabierto'; auditoria(c, 'Reapertura autorizada', a.motivo);
      } else {
        const filas = d.produccion.filter(r => (r.fecha || fechaRelativa(-r.dia)) === fecha(a) && r.orden === a.orden && r.turno === a.turno);
        const actual = filas.reduce((s, r) => s + r.reportadas, 0);
        if (actual !== a.cambio.de) error('El conteo cambió después de solicitar el ajuste. Rechaza y solicita uno actualizado.', 409);
        if (!filas.length) error('No hay producción que corregir.');
        let diferencia = a.cambio.a - actual;
        for (const f of filas) { const cambio = diferencia < 0 ? Math.max(diferencia, -f.reportadas) : diferencia; f.reportadas += cambio; diferencia -= cambio; }
      }
    }
    a.estado = decision === 'aprobar' ? 'Aprobada' : 'Rechazada'; a.resolvio = { nombre: usuario().nombre, rol: usuario().rol };
    a.diaResolucion = 0; a.fechaResolucion = hoyISO(); a.horaResolucion = hora(); a.motivoResolucion = texto(motivo);
    guardar(d); return { ok: true };
  };
  return conEscritura(ejecutar);
}
