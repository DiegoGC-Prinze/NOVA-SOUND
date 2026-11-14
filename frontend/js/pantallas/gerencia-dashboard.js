// Pantalla: Gerencia · Dashboard.
// Meta, producción, faltante y avance; unidades por disposición; top de defectos;
// avance de órdenes y cajas por cliente. Filtros: turno, línea, modelo y orden.

import { montarPagina } from '../layout.js';
import { dashboard, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, barra, chip, chipUnidad, cargarEn, estadoVacio } from '../componentes.js';
import { esc, num, pct, pctDe, fechaCorta, fechaLarga, hoyISO } from '../ui.js';

const pagina = montarPagina('gerencia/dashboard');

function iniciar({ sesion, contenido }) {
  contenido.innerHTML = `
    ${encabezado(sesion, 'Dashboard')}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  const leerFiltros = () => ({
    turno: document.getElementById('turno').value,
    linea: document.getElementById('linea').value,
    modelo: document.getElementById('modelo').value,
    orden: document.getElementById('orden').value,
  });
  const cargarResultado = () =>
    cargarEn(zonaResultado, async () => {
      const datos = await dashboard(leerFiltros());
      return { html: htmlDashboard(datos), listo: () => conectarVistaDefectos(datos) };
    });

  cargarEn(zonaFiltros, async () => {
    const op = await opciones();
    const todos = { valor: '', texto: 'Todos' };
    return {
      html: `
        <form class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros del dashboard" onsubmit="return false">
          ${campo({ id: 'turno', etiqueta: 'Turno', opciones: [todos, ...op.turnos.map((t) => ({ valor: t.valor, texto: t.nombre }))], clase: 'w-52' })}
          ${campo({ id: 'linea', etiqueta: 'Línea', opciones: [todos, ...op.lineas], clase: 'w-32' })}
          ${campo({ id: 'modelo', etiqueta: 'Modelo', opciones: [todos, ...op.modelos], clase: 'w-40' })}
          ${campo({ id: 'orden', etiqueta: 'Orden', opciones: [todos, ...op.ordenes.map((o) => ({ valor: o.id, texto: `${o.id} · ${o.cliente} · ${o.modelo} ${o.color}` }))], clase: 'w-72' })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
          <p class="ml-auto self-center text-xs text-suave">Datos de hoy, ${esc(fechaLarga(hoyISO()))}</p>
        </form>`,
      listo: () => {
        ['turno', 'linea', 'modelo', 'orden'].forEach((id) => document.getElementById(id).addEventListener('change', cargarResultado));
        document.getElementById('limpiar').addEventListener('click', () => {
          ['turno', 'linea', 'modelo', 'orden'].forEach((id) => (document.getElementById(id).value = ''));
          cargarResultado();
        });
        cargarResultado();
      },
    };
  });
}

// ---------------------------------------------------------------- Pintado
function tonoAvance(avance) {
  if (avance >= 100) return 'exito';
  if (avance >= 85) return 'marca';
  if (avance >= 70) return 'aviso';
  return 'peligro';
}

function htmlDashboard(d) {
  const r = d.resumen;
  if (!r.meta && !r.producidas) {
    return `<div class="tarjeta">${estadoVacio('No hay producción con estos filtros', 'Prueba con otra combinación de turno, línea, modelo u orden.')}</div>`;
  }
  const disp = d.disposiciones;
  const totalDisp = disp.liberadas + disp.retenidas + disp.retrabajo + disp.scrap;
  const rechazo = pctDe(disp.retenidas + disp.retrabajo + disp.scrap, totalDisp);

  const filasDisp = [
    ['LIBERADA', 'Liberadas', disp.liberadas, 'exito'],
    ['EN_RETENCION', 'En retención', disp.retenidas, 'aviso'],
    ['RETRABAJO', 'En retrabajo', disp.retrabajo, 'retrabajo'],
    ['SCRAP', 'Scrap', disp.scrap, 'peligro'],
  ]
    .map(
      ([estado, , cantidad, tono]) => `
      <li class="grid grid-cols-[8rem_1fr_6.5rem] items-center gap-3">
        <span>${chipUnidad(estado)}</span>
        ${barra(pctDe(cantidad, totalDisp), tono)}
        <span class="text-right tabular-nums"><strong>${num(cantidad)}</strong> <span class="text-xs text-suave">${pct(pctDe(cantidad, totalDisp))}</span></span>
      </li>`,
    )
    .join('');

  const estados = { 'A tiempo': 'exito', 'En riesgo': 'aviso', Atrasada: 'peligro' };
  const tablaOrdenes = tabla({
    vacio: 'No hay órdenes con estos filtros.',
    filas: d.ordenes,
    columnas: [
      { titulo: 'Orden', html: (o) => `<strong>${esc(o.id)}</strong>` },
      { titulo: 'Cliente', campo: 'cliente' },
      { titulo: 'Modelo', texto: (o) => `${o.modelo} · ${o.color}` },
      { titulo: 'Línea', campo: 'linea' },
      { titulo: 'Avance', html: (o) => `<div class="flex min-w-36 items-center gap-2"><div class="flex-1">${barra(o.avance, estados[o.estado])}</div><span class="w-12 text-right text-xs tabular-nums">${pct(o.avance)}</span></div>` },
      { titulo: 'Producidas / cantidad', num: true, texto: (o) => `${num(o.producidas)} / ${num(o.cantidad)}` },
      { titulo: 'Faltante', num: true, texto: (o) => num(o.faltante) },
      { titulo: 'Compromiso', texto: (o) => fechaCorta(o.compromiso) },
      { titulo: 'Estado', html: (o) => chip(o.estado, estados[o.estado]) },
    ],
  });

  const tablaCajas = tabla({
    vacio: 'No hay cajas con estos filtros.',
    filas: d.cajasPorCliente,
    columnas: [
      { titulo: 'Cliente', html: (c) => `<strong>${esc(c.cliente)}</strong>` },
      { titulo: 'Preparadas', num: true, texto: (c) => num(c.preparadas) },
      { titulo: 'Pendientes', num: true, texto: (c) => num(c.pendientes) },
      { titulo: 'Embarcadas', num: true, texto: (c) => num(c.embarcadas) },
    ],
  });

  return `
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${indicador({ titulo: 'Meta', valor: num(r.meta), nota: 'unidades por producir', tono: 'marca' })}
      ${indicador({ titulo: 'Producción', valor: num(r.producidas), nota: 'unidades reportadas', tono: 'exito' })}
      ${indicador({ titulo: 'Faltante', valor: num(r.faltante), nota: 'para llegar a la meta', tono: r.faltante ? 'aviso' : 'exito' })}
      <div class="tarjeta border-l-4 border-l-marca px-4 py-3">
        <p class="text-xs text-suave">Avance</p>
        <p class="mt-0.5 text-2xl font-bold tabular-nums">${pct(r.avance)}</p>
        <div class="mt-2">${barra(r.avance, tonoAvance(r.avance))}</div>
      </div>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      ${tarjeta('Unidades por disposición', `<ul class="flex flex-col gap-3">${filasDisp}</ul><p class="mt-4 text-xs text-suave">Rechazo (retención, retrabajo y scrap): <strong class="text-texto">${pct(rechazo)}</strong> de ${num(totalDisp)} unidades.</p>`)}
      <div id="tarjeta-defectos"></div>
    </div>

    <div class="mt-4">${tarjeta('Avance de órdenes', tablaOrdenes, { relleno: false })}</div>
    <div class="mt-4">${tarjeta('Cajas por cliente', tablaCajas, { relleno: false })}</div>`;
}

// Top de defectos con dos vistas: por defecto o por categoría.
function conectarVistaDefectos(d) {
  const zona = document.getElementById('tarjeta-defectos');
  if (!zona) return;
  let vista = 'defecto';

  function pintar() {
    const grupos = new Map();
    d.defectos.forEach((x) => {
      const clave = vista === 'defecto' ? x.defecto : x.categoria;
      const previo = grupos.get(clave) || { etiqueta: clave, detalle: vista === 'defecto' ? x.categoria : '', cantidad: 0 };
      previo.cantidad += x.cantidad;
      grupos.set(clave, previo);
    });
    const lista = [...grupos.values()].sort((a, b) => b.cantidad - a.cantidad);
    const total = lista.reduce((t, x) => t + x.cantidad, 0);
    const top = lista.slice(0, 6);

    const botones = [['defecto', 'Por defecto'], ['categoria', 'Por categoría']]
      .map(([v, texto]) => `<button type="button" data-vista="${v}" aria-pressed="${v === vista}" class="btn h-8 px-3 ${v === vista ? 'btn-principal' : 'btn-secundario'}">${texto}</button>`)
      .join('');

    const cuerpo = top.length
      ? `<ol class="flex flex-col gap-3">${top
          .map(
            (x) => `<li class="grid grid-cols-[1fr_6.5rem] items-center gap-3">
              <div><div class="flex items-baseline justify-between gap-2"><span class="font-medium">${esc(x.etiqueta)}</span>${x.detalle ? `<span class="text-xs text-suave">${esc(x.detalle)}</span>` : ''}</div>
              <div class="mt-1">${barra(pctDe(x.cantidad, top[0].cantidad * 1.0 || 1) , 'marca')}</div></div>
              <span class="text-right tabular-nums"><strong>${num(x.cantidad)}</strong> <span class="text-xs text-suave">${pct(pctDe(x.cantidad, total))}</span></span>
            </li>`,
          )
          .join('')}</ol><p class="mt-4 text-xs text-suave">Porcentaje sobre ${num(total)} defectos registrados.</p>`
      : estadoVacio('Sin defectos registrados', 'No hubo defectos con estos filtros.');

    zona.innerHTML = tarjeta('Top de defectos', cuerpo, { acciones: `<div class="flex gap-1" role="group" aria-label="Vista del top de defectos">${botones}</div>` });
    zona.querySelectorAll('[data-vista]').forEach((b) =>
      b.addEventListener('click', () => {
        vista = b.dataset.vista;
        pintar();
      }),
    );
  }
  pintar();
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
