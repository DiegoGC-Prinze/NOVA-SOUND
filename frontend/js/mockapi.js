// Respuestas de ejemplo para api.js (solo se usan con USE_MOCKS = true).
// Aquí está la "lógica del back" fingida: filtros, sumas y guardado de cambios.
// Cuando el back real esté listo, este archivo ya no se usa; lo que debe devolver el back
// tiene la misma forma que lo que devuelven estas funciones.

import { coleccion, guardarColeccion, leerJSON, pausa } from './mockdb.js';
import { ErrorApi } from './errores.js';
import { fechaRelativa, diasEntre, hoyISO, normalizar } from './ui.js';
import { obtenerSesion } from './session.js';

const suma = (filas, campo) => filas.reduce((t, f) => t + (f[campo] || 0), 0);
const ahoraHora = () => new Date().toTimeString().slice(0, 5);

function agrupar(filas, clave) {
  const grupos = new Map();
  filas.forEach((f) => {
    const k = clave(f);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  });
  return grupos;
}

// ---------------------------------------------------------------- Sesión
export async function iniciarSesion(numEmpleado, contrasena) {
  await pausa(350);
  const usuarios = await coleccion('usuarios');
  const u = usuarios.find((x) => x.numEmpleado === String(numEmpleado).trim());
  if (!u || u.contrasena !== contrasena) {
    throw new ErrorApi('El número de empleado o la contraseña no son correctos.', 401);
  }
  if (u.estado !== 'Activo') {
    throw new ErrorApi('Tu cuenta está bloqueada. Levanta un ticket para recuperarla.', 403);
  }
  const { roles } = await coleccion('roles-permisos');
  const rol = roles.find((r) => r.nombre === u.rol);
  return {
    token: `mock-${u.numEmpleado}`,
    usuario: { numEmpleado: u.numEmpleado, nombre: u.nombre, rol: u.rol },
    permisos: rol ? rol.permisos : {},
    acciones: rol ? rol.acciones : [],
  };
}

export async function usuariosDeEjemplo() {
  const usuarios = await coleccion('usuarios');
  return usuarios.map(({ numEmpleado, nombre, rol, estado }) => ({ numEmpleado, nombre, rol, estado }));
}

// ---------------------------------------------------------------- Opciones de los filtros
export async function opciones() {
  await pausa(120);
  return leerJSON('opciones');
}

// ---------------------------------------------------------------- Gerencia
export async function dashboard(f = {}) {
  await pausa();
  const [prod, def, ords] = await Promise.all([leerJSON('produccion'), leerJSON('defectos'), leerJSON('ordenes')]);
  const cumple = (r) =>
    (!f.turno || r.turno === Number(f.turno)) &&
    (!f.linea || r.linea === f.linea) &&
    (!f.modelo || r.modelo === f.modelo) &&
    (!f.orden || r.orden === f.orden);

  const hoy = prod.filter((r) => r.dia === 0 && cumple(r));
  const meta = suma(hoy, 'meta');
  const producidas = suma(hoy, 'reportadas');

  const defectosHoy = def.filter((r) => r.dia === 0 && cumple(r));
  const porDefecto = new Map();
  defectosHoy.forEach((d) => {
    const k = `${d.categoria}|${d.defecto}`;
    porDefecto.set(k, { categoria: d.categoria, defecto: d.defecto, cantidad: (porDefecto.get(k)?.cantidad || 0) + d.cantidad });
  });

  // Órdenes: no dependen del turno. El estado se calcula con el ritmo de los últimos 7 días.
  const ordenes = ords
    .filter((o) => (!f.linea || o.linea === f.linea) && (!f.modelo || o.modelo === f.modelo) && (!f.orden || o.id === f.orden))
    .map((o) => {
      const faltante = Math.max(o.cantidad - o.producidas, 0);
      const ritmoDiario = suma(prod.filter((r) => r.orden === o.id), 'reportadas') / 7;
      const diasNecesarios = ritmoDiario ? faltante / ritmoDiario : 0;
      const estado = diasNecesarios <= o.compromisoEnDias * 0.9 ? 'A tiempo' : diasNecesarios <= o.compromisoEnDias * 1.2 ? 'En riesgo' : 'Atrasada';
      return {
        id: o.id, cliente: o.cliente, modelo: o.modelo, color: o.color, linea: o.linea,
        cantidad: o.cantidad, producidas: o.producidas, faltante,
        avance: (o.producidas / o.cantidad) * 100,
        compromiso: fechaRelativa(o.compromisoEnDias), estado, cajas: o.cajas,
      };
    });

  const porCliente = [...agrupar(ordenes, (o) => o.cliente)].map(([cliente, os]) => ({
    cliente,
    preparadas: os.reduce((t, o) => t + o.cajas.preparadas, 0),
    pendientes: os.reduce((t, o) => t + o.cajas.pendientes, 0),
    embarcadas: os.reduce((t, o) => t + o.cajas.embarcadas, 0),
  }));

  return {
    resumen: { meta, producidas, faltante: Math.max(meta - producidas, 0), avance: meta ? (producidas / meta) * 100 : 0 },
    disposiciones: {
      liberadas: suma(hoy, 'liberadas'), retenidas: suma(hoy, 'retenidas'),
      retrabajo: suma(hoy, 'retrabajo'), scrap: suma(hoy, 'scrap'),
    },
    defectos: [...porDefecto.values()],
    ordenes,
    cajasPorCliente: porCliente,
  };
}

export async function discrepancias(f = {}) {
  await pausa();
  const prod = await leerJSON('produccion');
  const dia = diasEntre(f.fecha || hoyISO(), hoyISO());
  const filas = prod.filter((r) => r.dia === dia && (!f.turno || r.turno === Number(f.turno)));
  const vista = f.vista || 'lote';
  const clave = { lote: (r) => r.lote, linea: (r) => r.linea, modelo: (r) => r.modelo }[vista];
  const resumen = (rs) => ({
    reportadas: suma(rs, 'reportadas'), liberadas: suma(rs, 'liberadas'), recibidas: suma(rs, 'recibidas'),
    noLiberadas: suma(rs, 'reportadas') - suma(rs, 'liberadas'), sinRecibir: suma(rs, 'liberadas') - suma(rs, 'recibidas'),
  });
  const detalle = [...agrupar(filas, clave)].map(([etiqueta, rs]) => ({
    etiqueta,
    linea: rs[0].linea, modelo: rs[0].modelo, orden: rs[0].orden, turno: rs[0].turno,
    ...resumen(rs),
  }));
  detalle.sort((a, b) => b.noLiberadas + b.sinRecibir - (a.noLiberadas + a.sinRecibir));
  const totales = resumen(filas);
  return { fecha: f.fecha || hoyISO(), turno: f.turno || null, vista, totales: { ...totales, diferencia: totales.reportadas - totales.recibidas }, filas: detalle };
}

export async function cierresTurno(f = {}) {
  await pausa();
  const prod = await leerJSON('produccion');
  const desde = f.desde || fechaRelativa(-6);
  const hasta = f.hasta || hoyISO();
  const grupos = agrupar(
    prod.filter((r) => {
      const fecha = fechaRelativa(-r.dia);
      return fecha >= desde && fecha <= hasta && (!f.linea || r.linea === f.linea) && (!f.turno || r.turno === Number(f.turno));
    }),
    (r) => `${r.dia}|${r.turno}|${r.linea}`,
  );
  const filas = [...grupos.values()].map((rs) => {
    const reportadas = suma(rs, 'reportadas');
    const empacadas = suma(rs, 'recibidas');
    const retenidas = suma(rs, 'retenidas');
    const retrabajo = suma(rs, 'retrabajo');
    const scrap = suma(rs, 'scrap');
    const diferencia = reportadas - empacadas;
    return {
      fecha: fechaRelativa(-rs[0].dia), turno: rs[0].turno, linea: rs[0].linea,
      reportadas, empacadas, retenidas, retrabajo, scrap, diferencia,
      sinExplicar: diferencia - retenidas - retrabajo - scrap,
    };
  });
  filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.turno - a.turno || a.linea.localeCompare(b.linea));
  return filas;
}

export async function autorizaciones() {
  await pausa();
  const lista = await coleccion('autorizaciones');
  const conFechas = (a) => ({
    ...a,
    fecha: fechaRelativa(-a.dia),
    fechaResolucion: a.diaResolucion != null ? fechaRelativa(-a.diaResolucion) : null,
  });
  return {
    pendientes: lista.filter((a) => a.estado === 'Pendiente').map(conFechas).sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora)),
    resueltas: lista.filter((a) => a.estado !== 'Pendiente').map(conFechas).sort((a, b) => (a.diaResolucion - b.diaResolucion) || b.horaResolucion.localeCompare(a.horaResolucion)),
  };
}

export async function resolverAutorizacion(id, { decision, motivo = '' }) {
  await pausa(300);
  const lista = await coleccion('autorizaciones');
  const a = lista.find((x) => x.id === id);
  if (!a || a.estado !== 'Pendiente') throw new ErrorApi('Esa solicitud ya fue resuelta.', 409);
  const sesion = obtenerSesion();
  a.estado = decision === 'aprobar' ? 'Aprobada' : 'Rechazada';
  a.resolvio = { nombre: sesion?.usuario.nombre || '—', rol: sesion?.usuario.rol || '—' };
  a.diaResolucion = 0;
  a.horaResolucion = ahoraHora();
  a.motivoResolucion = motivo;
  guardarColeccion('autorizaciones', lista);
  return { ok: true };
}

export async function unidadPorSerie(serie) {
  await pausa();
  const unidades = await leerJSON('unidades');
  const q = normalizar(serie);
  let u = unidades.find((x) => normalizar(x.serie) === q);
  if (!u && q.length >= 3) {
    const parecidas = unidades.filter((x) => normalizar(x.serie).includes(q));
    if (parecidas.length === 1) u = parecidas[0];
  }
  if (!u) throw new ErrorApi(`No se encontró la serie «${serie}».`, 404);
  return {
    ...u,
    fecha: fechaRelativa(-u.dia),
    embarque: u.embarque ? { ...u.embarque, fechaSalida: fechaRelativa(-u.embarque.fechaSalidaDias) } : null,
    historial: u.historial.map((e) => ({ ...e, fecha: fechaRelativa(-e.dia) })),
  };
}

export async function seriesDeEjemplo() {
  const unidades = await leerJSON('unidades');
  return unidades.map((u) => ({ serie: u.serie, estado: u.estado }));
}

// ---------------------------------------------------------------- Tickets
export async function levantarTicket({ numEmpleado, nombre, motivo }) {
  await pausa(350);
  const lista = await coleccion('tickets');
  const siguiente = Math.max(0, ...lista.map((t) => Number(t.id.slice(2)))) + 1;
  const id = `T-${String(siguiente).padStart(4, '0')}`;
  lista.push({ id, numEmpleado: String(numEmpleado).trim(), nombre: nombre.trim(), motivo, estado: 'Abierto', dia: 0, hora: ahoraHora(), comentarios: '' });
  guardarColeccion('tickets', lista);
  return { id };
}

const conFechaTicket = (t) => ({ ...t, fecha: fechaRelativa(-t.dia) });

export async function tickets() {
  await pausa();
  const lista = await coleccion('tickets');
  return lista.map(conFechaTicket).sort((a, b) => (a.estado === b.estado ? a.dia - b.dia || b.hora.localeCompare(a.hora) : a.estado === 'Abierto' ? -1 : 1));
}

export async function ticket(id) {
  await pausa(150);
  const t = (await coleccion('tickets')).find((x) => x.id === id);
  if (!t) throw new ErrorApi('No se encontró el ticket.', 404);
  return conFechaTicket(t);
}

export async function cerrarTicket(id, { comentarios }) {
  await pausa(300);
  const lista = await coleccion('tickets');
  const t = lista.find((x) => x.id === id);
  if (!t) throw new ErrorApi('No se encontró el ticket.', 404);
  t.estado = 'Cerrado';
  t.comentarios = comentarios;
  guardarColeccion('tickets', lista);
  return { ok: true };
}

// ---------------------------------------------------------------- Usuarios
export async function usuarios(q = '') {
  await pausa();
  const lista = await coleccion('usuarios');
  const b = normalizar(q);
  return lista
    .filter((u) => !b || normalizar(`${u.numEmpleado} ${u.nombre} ${u.rol}`).includes(b))
    .map(({ contrasena, ...resto }) => resto);
}

export async function usuario(numEmpleado) {
  await pausa(150);
  const u = (await coleccion('usuarios')).find((x) => x.numEmpleado === numEmpleado);
  if (!u) throw new ErrorApi('No se encontró el usuario.', 404);
  const { contrasena, ...resto } = u;
  return resto;
}

export async function guardarUsuario(datos, esNuevo) {
  await pausa(350);
  const lista = await coleccion('usuarios');
  const existe = lista.find((x) => x.numEmpleado === datos.numEmpleado);
  if (esNuevo && existe) throw new ErrorApi('Ya existe un usuario con ese número de empleado.', 409);
  if (!esNuevo && !existe) throw new ErrorApi('No se encontró el usuario.', 404);
  if (esNuevo) {
    lista.push({ ...datos });
  } else {
    Object.assign(existe, datos, { contrasena: datos.contrasena || existe.contrasena });
  }
  guardarColeccion('usuarios', lista);
  return { ok: true };
}

// ---------------------------------------------------------------- Roles y permisos
export async function rolesPermisos() {
  await pausa(200);
  return coleccion('roles-permisos');
}

export async function guardarRol(nombre, { permisos, acciones }) {
  await pausa(350);
  const datos = await coleccion('roles-permisos');
  const rol = datos.roles.find((r) => r.nombre === nombre);
  if (!rol) throw new ErrorApi('No se encontró el rol.', 404);
  rol.permisos = permisos;
  rol.acciones = acciones;
  guardarColeccion('roles-permisos', datos);
  return { ok: true };
}

// ---------------------------------------------------------------- Catálogos
export async function catalogos() {
  await pausa(200);
  return coleccion('catalogos');
}

export async function guardarElementoCatalogo(tipo, elemento) {
  await pausa(300);
  const datos = await coleccion('catalogos');
  if (!datos[tipo]) throw new ErrorApi('No existe ese catálogo.', 404);
  if (datos[tipo].items.some((i) => i.codigo.toLowerCase() === elemento.codigo.toLowerCase())) {
    throw new ErrorApi(`Ya existe un elemento con el código «${elemento.codigo}».`, 409);
  }
  datos[tipo].items.push(elemento);
  guardarColeccion('catalogos', datos);
  return { ok: true };
}

export async function cambiarEstadoCatalogo(tipo, codigo, estado) {
  await pausa(200);
  const datos = await coleccion('catalogos');
  const item = datos[tipo]?.items.find((i) => i.codigo === codigo);
  if (!item) throw new ErrorApi('No se encontró el elemento.', 404);
  item.estado = estado;
  guardarColeccion('catalogos', datos);
  return { ok: true };
}

// ---------------------------------------------------------------- Parámetros
export async function parametros() {
  await pausa(200);
  const p = await coleccion('parametros');
  return { ...p, ultimoCambio: { ...p.ultimoCambio, fecha: fechaRelativa(-(p.ultimoCambio.dia || 0)) } };
}

export async function guardarParametros({ capacidadCaja, motivo }) {
  await pausa(350);
  const sesion = obtenerSesion();
  guardarColeccion('parametros', {
    capacidadCaja,
    ultimoCambio: { por: sesion?.usuario.nombre || '—', dia: 0, hora: ahoraHora(), motivo },
  });
  return { ok: true };
}
