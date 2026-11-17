// Pantalla: Calidad · Reportes de calidad.
// Resumen de un periodo: unidades liberadas, retenidas, en retrabajo y scrap; defectos por categoría
// (cantidad y porcentaje) y detalle por defecto. Filtros: fechas, turno, línea y modelo.
// Se puede exportar a Excel (el formato final se valida con el cliente).

import { montarPagina } from '../layout.js';
import { reporteCalidad, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, barra, marcarError, cargarEn, estadoVacio } from '../componentes.js';
import { esc, num, pct, pctDe, fechaCorta, fechaRelativa, hoyISO } from '../ui.js';
import { descargarExcel } from '../exportar.js';

const pagina = montarPagina('calidad/reportes-de-calidad');

function iniciar({ sesion, contenido }) {
  contenido.innerHTML = `
    ${encabezado(sesion, 'Reportes de calidad', boton('Exportar a Excel', { tipo: 'secundario', id: 'exportar', extra: 'disabled' }))}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  let reporte = null;

  const leerFiltros = () => ({
    desde: document.getElementById('desde').value,
    hasta: document.getElementById('hasta').value,
    turno: document.getElementById('turno').value,
    linea: document.getElementById('linea').value,
    modelo: document.getElementById('modelo').value,
  });

  function generar() {
    const f = leerFiltros();
    marcarError('desde', '');
    marcarError('hasta', '');
    if (!f.desde) return marcarError('desde', 'Elige la fecha inicial.');
    if (!f.hasta) return marcarError('hasta', 'Elige la fecha final.');
    if (f.desde > f.hasta) return marcarError('desde', 'La fecha inicial no puede ser después de la final.');
    document.getElementById('exportar').disabled = true;
    return cargarEn(
      zonaResultado,
      async () => {
        reporte = await reporteCalidad(f);
        document.getElementById('exportar').disabled = !(reporte.total || reporte.totalDefectos);
        return htmlReporte(reporte);
      },
      'Generando el reporte…',
    );
  }

  cargarEn(zonaFiltros, async () => {
    const op = await opciones('calidad');
    const todos = { valor: '', texto: 'Todos' };
    return {
      html: `
        <form id="form-filtros" class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros del reporte de calidad" novalidate>
          ${campo({ id: 'desde', etiqueta: 'Desde', tipo: 'date', valor: fechaRelativa(-6), extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${campo({ id: 'hasta', etiqueta: 'Hasta', tipo: 'date', valor: hoyISO(), extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${campo({ id: 'turno', etiqueta: 'Turno', opciones: [todos, ...op.turnos.map((t) => ({ valor: t.valor, texto: t.nombre }))], clase: 'w-52' })}
          ${campo({ id: 'linea', etiqueta: 'Línea', opciones: [{ valor: '', texto: 'Todas' }, ...op.lineas], clase: 'w-32' })}
          ${campo({ id: 'modelo', etiqueta: 'Modelo', opciones: [todos, ...op.modelos], clase: 'w-40' })}
          ${boton('Generar reporte', { enviar: true })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
        </form>`,
      listo: () => {
        document.getElementById('form-filtros').addEventListener('submit', (e) => {
          e.preventDefault();
          generar();
        });
        document.getElementById('limpiar').addEventListener('click', () => {
          document.getElementById('desde').value = fechaRelativa(-6);
          document.getElementById('hasta').value = hoyISO();
          ['turno', 'linea', 'modelo'].forEach((id) => (document.getElementById(id).value = ''));
          generar();
        });
        generar();
      },
    };
  });

  document.getElementById('exportar').addEventListener('click', () => {
    if (!reporte) return;
    descargarExcel(`reporte-de-calidad_${reporte.desde}_${reporte.hasta}.xlsx`, 'Reporte de calidad', COLUMNAS_EXCEL, filasExcel(reporte));
  });
}

// ---------------------------------------------------------------- Excel
const COLUMNAS_EXCEL = [
  { titulo: 'Sección', ancho: 24, valor: (f) => f.seccion },
  { titulo: 'Concepto', ancho: 38, valor: (f) => f.concepto },
  { titulo: 'Cantidad', tipo: 'numero', ancho: 13, valor: (f) => f.cantidad },
  { titulo: '% del total', ancho: 13, centrar: true, valor: (f) => pct(f.porcentaje) },
];

function filasExcel(r) {
  const d = r.disposiciones;
  const disp = [['Liberadas', d.liberadas], ['Retenidas', d.retenidas], ['Retrabajo', d.retrabajo], ['Scrap', d.scrap]].map(([concepto, cantidad]) => ({
    seccion: 'Disposición de unidades', concepto, cantidad, porcentaje: pctDe(cantidad, r.total),
  }));
  const categorias = r.defectosPorCategoria.map((c) => ({ seccion: 'Defectos por categoría', concepto: c.categoria, cantidad: c.cantidad, porcentaje: c.porcentaje }));
  const detalle = r.detalleDefectos.map((x) => ({ seccion: 'Detalle de defectos', concepto: `${x.categoria} · ${x.defecto}`, cantidad: x.cantidad, porcentaje: x.porcentaje }));
  return [...disp, ...categorias, ...detalle];
}

// ---------------------------------------------------------------- Pintado
function htmlReporte(r) {
  if (!r.total && !r.totalDefectos) {
    return `<div class="tarjeta">${estadoVacio('No hay información de calidad con estos filtros', 'Prueba con otras fechas, otro turno, otra línea u otro modelo.')}</div>`;
  }
  const d = r.disposiciones;
  const nota = (n) => `${pct(pctDe(n, r.total))} del total`;
  const maximo = Math.max(1, ...r.defectosPorCategoria.map((c) => c.cantidad));

  const porCantidad = r.defectosPorCategoria
    .map(
      (c) => `<li class="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3">
        <span class="text-sm">${esc(c.categoria)}</span>${barra(pctDe(c.cantidad, maximo), 'marca')}
        <span class="text-right font-semibold tabular-nums">${num(c.cantidad)}</span></li>`,
    )
    .join('');
  const porPorcentaje = r.defectosPorCategoria
    .map(
      (c) => `<li class="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3">
        <span class="text-sm">${esc(c.categoria)}</span>${barra(c.porcentaje, 'marca')}
        <span class="text-right font-semibold tabular-nums">${pct(c.porcentaje)}</span></li>`,
    )
    .join('');

  const detalle = tabla({
    filas: r.detalleDefectos,
    vacio: 'No hubo defectos en este periodo',
    columnas: [
      { titulo: 'Categoría', campo: 'categoria' },
      { titulo: 'Defecto', html: (x) => `<strong>${esc(x.defecto)}</strong>` },
      { titulo: 'Cantidad', num: true, texto: (x) => num(x.cantidad) },
      { titulo: '% de los defectos', num: true, texto: (x) => pct(x.porcentaje) },
    ],
  });

  return `
    <p class="mb-3 text-sm text-suave">Periodo: <strong class="text-texto">${esc(fechaCorta(r.desde))}</strong> al <strong class="text-texto">${esc(fechaCorta(r.hasta))}</strong> · ${num(r.total)} unidades con disposición · ${num(r.totalDefectos)} defectos</p>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${indicador({ titulo: 'Liberadas', valor: num(d.liberadas), nota: nota(d.liberadas), tono: 'exito' })}
      ${indicador({ titulo: 'Retenidas', valor: num(d.retenidas), nota: nota(d.retenidas), tono: 'aviso' })}
      ${indicador({ titulo: 'Retrabajo', valor: num(d.retrabajo), nota: nota(d.retrabajo), tono: 'retrabajo' })}
      ${indicador({ titulo: 'Scrap', valor: num(d.scrap), nota: nota(d.scrap), tono: 'peligro' })}
    </div>
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      ${tarjeta('Defectos por categoría', `<ul class="space-y-3">${porCantidad}</ul>`)}
      ${tarjeta('Porcentaje por categoría', `<ul class="space-y-3">${porPorcentaje}</ul>`)}
    </div>
    <div class="mt-4">${tarjeta('Detalle de defectos', detalle, { relleno: false })}</div>`;
}

if (pagina) iniciar(pagina);
