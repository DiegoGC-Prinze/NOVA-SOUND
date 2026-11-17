// Pantalla: Calidad · Resumen de calidad.
// Lo de hoy: unidades liberadas, retenidas, en retrabajo y scrap; defectos por categoría y las unidades
// que esperan inspección (con botón «Inspeccionar»). Filtros: turno y línea.

import { montarPagina, rutaA } from '../layout.js';
import { resumenCalidad, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, barra, cargarEn } from '../componentes.js';
import { esc, num, pct, pctDe, fechaLarga, hoyISO } from '../ui.js';
import { puedeDisponer } from './calidad-comun.js';

const pagina = montarPagina('calidad/resumen-de-calidad');

const INSPECCION = (serie) => rutaA(`pages/calidad/inspeccion-de-unidad.html?serie=${encodeURIComponent(serie)}`);
const HISTORIAL = (serie) => rutaA(`pages/calidad/historial-de-la-unidad.html?serie=${encodeURIComponent(serie)}`);

function iniciar(pagina) {
  const { sesion, contenido } = pagina;
  const puedeInspeccionar = puedeDisponer(pagina);

  contenido.innerHTML = `
    ${encabezado(sesion, 'Resumen de calidad')}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  const leerFiltros = () => ({ turno: document.getElementById('turno').value, linea: document.getElementById('linea').value });
  const cargarResultado = () =>
    cargarEn(zonaResultado, async () => {
      const datos = await resumenCalidad(leerFiltros());
      return { html: htmlResumen(datos, puedeInspeccionar), listo: conectarBusqueda };
    });

  cargarEn(zonaFiltros, async () => {
    const op = await opciones('calidad');
    const todos = { valor: '', texto: 'Todos' };
    return {
      html: `
        <form class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros del resumen de calidad" onsubmit="return false">
          ${campo({ id: 'turno', etiqueta: 'Turno', opciones: [todos, ...op.turnos.map((t) => ({ valor: t.valor, texto: t.nombre }))], clase: 'w-52' })}
          ${campo({ id: 'linea', etiqueta: 'Línea', opciones: [{ valor: '', texto: 'Todas' }, ...op.lineas], clase: 'w-32' })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
          <p class="ml-auto self-center text-xs text-suave">Datos de hoy, ${esc(fechaLarga(hoyISO()))}</p>
        </form>`,
      listo: () => {
        ['turno', 'linea'].forEach((id) => document.getElementById(id).addEventListener('change', cargarResultado));
        document.getElementById('limpiar').addEventListener('click', () => {
          ['turno', 'linea'].forEach((id) => (document.getElementById(id).value = ''));
          cargarResultado();
        });
        cargarResultado();
      },
    };
  });
}

// ---------------------------------------------------------------- Pintado
function htmlResumen(d, puedeInspeccionar) {
  const x = d.disposiciones;
  const total = x.liberadas + x.retenidas + x.retrabajo + x.scrap;
  const nota = (n) => `${pct(pctDe(n, total))} del total`;

  const maximo = Math.max(1, ...d.defectosPorCategoria.map((c) => c.cantidad));
  const totalDefectos = d.defectosPorCategoria.reduce((t, c) => t + c.cantidad, 0);
  const filasCategorias = totalDefectos
    ? d.defectosPorCategoria
        .map(
          (c) => `
      <li class="grid grid-cols-[8rem_1fr_6.5rem] items-center gap-3">
        <span class="text-sm">${esc(c.categoria)}</span>
        ${barra(pctDe(c.cantidad, maximo), 'marca')}
        <span class="text-right tabular-nums"><strong>${num(c.cantidad)}</strong> <span class="text-xs text-suave">${pct(c.porcentaje)}</span></span>
      </li>`,
        )
        .join('')
    : '<li class="text-sm text-suave">No hay defectos con estos filtros.</li>';

  const columnas = [
    { titulo: 'Unidad', html: (u) => `<strong class="tabular-nums">${esc(u.serie)}</strong>` },
    { titulo: 'Modelo', texto: (u) => `${u.modelo} · ${u.color}` },
    { titulo: 'Lote', campo: 'lote' },
    { titulo: 'Línea', campo: 'linea' },
    { titulo: 'Turno', texto: (u) => `Turno ${u.turno}` },
    {
      titulo: 'Acción',
      html: (u) =>
        puedeInspeccionar
          ? `<a class="btn btn-principal h-8 px-3" href="${INSPECCION(u.serie)}" aria-label="Inspeccionar ${esc(u.serie)}">Inspeccionar</a>`
          : `<a class="btn btn-secundario h-8 px-3" href="${HISTORIAL(u.serie)}">Ver historial</a>`,
    },
  ];

  return `
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${indicador({ titulo: 'Liberadas', valor: num(x.liberadas), nota: nota(x.liberadas), tono: 'exito' })}
      ${indicador({ titulo: 'Retenidas', valor: num(x.retenidas), nota: nota(x.retenidas), tono: 'aviso' })}
      ${indicador({ titulo: 'Retrabajo', valor: num(x.retrabajo), nota: nota(x.retrabajo), tono: 'retrabajo' })}
      ${indicador({ titulo: 'Scrap', valor: num(x.scrap), nota: nota(x.scrap), tono: 'peligro' })}
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
      ${tarjeta('Defectos por categoría', `<ul class="space-y-3">${filasCategorias}</ul>`)}
      <div class="grid gap-4">
        <div class="tarjeta border-l-4 border-l-marca px-4 py-3">
          <p class="text-xs text-suave">Pendientes de inspección</p>
          <p class="mt-0.5 text-2xl font-bold tabular-nums" id="total-pendientes">${num(d.pendientes.length)}</p>
          <p class="mt-0.5 text-xs text-suave">unidades probadas que esperan a Calidad</p>
        </div>
        <form id="form-buscar" class="tarjeta p-3" role="search" novalidate>
          <label class="etiqueta" for="serie-buscar">Buscar unidad</label>
          <div class="flex gap-2">
            <input id="serie-buscar" type="search" class="campo flex-1" placeholder="Escanea o escribe la serie" autocomplete="off">
            ${boton('Buscar', { enviar: true })}
          </div>
          <p class="mt-1 text-xs text-suave">Abre el historial completo de la unidad.</p>
        </form>
      </div>
    </div>

    <div class="mt-4">
      ${tarjeta(
        'Unidades pendientes de inspección',
        tabla({ filas: d.pendientes, columnas, vacio: 'No hay unidades pendientes de inspección', detalleVacio: 'Todo lo que llegó de Prueba funcional ya fue inspeccionado.' }),
        { relleno: false },
      )}
    </div>`;
}

// «Buscar unidad» abre el historial de la serie que se escribió o se escaneó.
function conectarBusqueda() {
  document.getElementById('form-buscar').addEventListener('submit', (e) => {
    e.preventDefault();
    const serie = document.getElementById('serie-buscar').value.trim();
    if (serie) location.href = HISTORIAL(serie);
  });
}

if (pagina) iniciar(pagina);
