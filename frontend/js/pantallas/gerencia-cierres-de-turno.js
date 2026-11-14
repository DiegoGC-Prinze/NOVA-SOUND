// Pantalla: Gerencia · Cierres de turno.
// Tabla con lo reportado, empacado, retenido, retrabajo, scrap y la diferencia por turno y línea.
// Filtros: desde, hasta, línea y turno. Se puede exportar a Excel (el formato final se valida con el cliente).

import { montarPagina } from '../layout.js';
import { cierresTurno, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, marcarError, cargarEn } from '../componentes.js';
import { num, fechaCorta, fechaRelativa, hoyISO } from '../ui.js';
import { descargarExcel } from '../exportar.js';

const pagina = montarPagina('gerencia/cierres-de-turno');

function iniciar({ sesion, contenido }) {
  contenido.innerHTML = `
    ${encabezado(sesion, 'Cierres de turno', boton('Exportar a Excel', { tipo: 'secundario', id: 'exportar', extra: 'disabled' }))}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  let filasActuales = [];
  let rango = {};

  const leerFiltros = () => ({
    desde: document.getElementById('desde').value,
    hasta: document.getElementById('hasta').value,
    linea: document.getElementById('linea').value,
    turno: document.getElementById('turno').value,
  });

  function cargarResultado() {
    const f = leerFiltros();
    marcarError('desde', '');
    marcarError('hasta', '');
    if (!f.desde) return marcarError('desde', 'Elige la fecha inicial.');
    if (!f.hasta) return marcarError('hasta', 'Elige la fecha final.');
    if (f.desde > f.hasta) return marcarError('desde', 'La fecha inicial no puede ser después de la final.');
    rango = f;
    document.getElementById('exportar').disabled = true;
    return cargarEn(zonaResultado, async () => {
      filasActuales = await cierresTurno(f);
      document.getElementById('exportar').disabled = !filasActuales.length;
      return htmlCierres(filasActuales);
    });
  }

  cargarEn(zonaFiltros, async () => {
    const op = await opciones();
    return {
      html: `
        <form id="form-filtros" class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros de cierres de turno" novalidate>
          ${campo({ id: 'desde', etiqueta: 'Desde', tipo: 'date', valor: fechaRelativa(-6), extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${campo({ id: 'hasta', etiqueta: 'Hasta', tipo: 'date', valor: hoyISO(), extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${campo({ id: 'linea', etiqueta: 'Línea', opciones: [{ valor: '', texto: 'Todas' }, ...op.lineas], clase: 'w-32' })}
          ${campo({ id: 'turno', etiqueta: 'Turno', opciones: [{ valor: '', texto: 'Todos' }, ...op.turnos.map((t) => ({ valor: t.valor, texto: t.nombre }))], clase: 'w-52' })}
          ${boton('Filtrar', { id: 'filtrar', enviar: true })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
        </form>`,
      listo: () => {
        document.getElementById('form-filtros').addEventListener('submit', (e) => {
          e.preventDefault();
          cargarResultado();
        });
        document.getElementById('limpiar').addEventListener('click', () => {
          document.getElementById('desde').value = fechaRelativa(-6);
          document.getElementById('hasta').value = hoyISO();
          document.getElementById('linea').value = '';
          document.getElementById('turno').value = '';
          cargarResultado();
        });
        cargarResultado();
      },
    };
  });

  document.getElementById('exportar').addEventListener('click', () => {
    descargarExcel(`cierres-de-turno_${rango.desde}_${rango.hasta}.xlsx`, 'Cierres de turno', COLUMNAS_EXCEL, filasActuales);
  });
}

const COLUMNAS_EXCEL = [
  { titulo: 'Fecha', tipo: 'fecha', ancho: 13, valor: (f) => f.fecha },
  { titulo: 'Turno', tipo: 'numero', centrar: true, ancho: 9, valor: (f) => f.turno },
  { titulo: 'Línea', centrar: true, ancho: 9, valor: (f) => f.linea },
  { titulo: 'Reportado', tipo: 'numero', ancho: 13, valor: (f) => f.reportadas },
  { titulo: 'Empacadas', tipo: 'numero', ancho: 13, valor: (f) => f.empacadas },
  { titulo: 'Retenidas', tipo: 'numero', ancho: 13, valor: (f) => f.retenidas },
  { titulo: 'Retrabajo', tipo: 'numero', ancho: 13, valor: (f) => f.retrabajo },
  { titulo: 'Scrap', tipo: 'numero', ancho: 11, valor: (f) => f.scrap },
  { titulo: 'Diferencia', tipo: 'numero', ancho: 13, valor: (f) => f.diferencia },
  { titulo: 'Sin explicar', tipo: 'numero', ancho: 15, valor: (f) => f.sinExplicar },
];

const suma = (filas, campo) => filas.reduce((t, f) => t + f[campo], 0);
const rojo = (n) => (n > 0 ? `<strong class="text-[#8E1B1B]">${num(n)}</strong>` : `<span class="text-suave">0</span>`);

function htmlCierres(filas) {
  const resumen = `
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${indicador({ titulo: 'Reportado', valor: num(suma(filas, 'reportadas')), nota: `${num(filas.length)} cierres`, tono: 'marca' })}
      ${indicador({ titulo: 'Empacadas', valor: num(suma(filas, 'empacadas')), tono: 'exito' })}
      ${indicador({ titulo: 'Diferencia', valor: num(suma(filas, 'diferencia')), nota: 'reportado − empacadas', tono: suma(filas, 'diferencia') ? 'aviso' : 'exito' })}
      ${indicador({ titulo: 'Sin explicar', valor: num(suma(filas, 'sinExplicar')), nota: 'diferencia que no es retención, retrabajo ni scrap', tono: suma(filas, 'sinExplicar') ? 'peligro' : 'exito' })}
    </div>`;

  const t = tabla({
    filas,
    vacio: 'No hay cierres en este rango',
    detalleVacio: 'Prueba con otras fechas, otra línea u otro turno.',
    columnas: [
      { titulo: 'Fecha', texto: (f) => fechaCorta(f.fecha) },
      { titulo: 'Turno', texto: (f) => `Turno ${f.turno}` },
      { titulo: 'Línea', campo: 'linea' },
      { titulo: 'Reportado', num: true, texto: (f) => num(f.reportadas) },
      { titulo: 'Empacadas', num: true, texto: (f) => num(f.empacadas) },
      { titulo: 'Retenidas', num: true, texto: (f) => num(f.retenidas) },
      { titulo: 'Retrabajo', num: true, texto: (f) => num(f.retrabajo) },
      { titulo: 'Scrap', num: true, texto: (f) => num(f.scrap) },
      { titulo: 'Diferencia', num: true, html: (f) => rojo(f.diferencia) },
      { titulo: 'Sin explicar', num: true, html: (f) => rojo(f.sinExplicar) },
    ],
  });
  return `${resumen}<div class="mt-4">${tarjeta('Cierres por turno y línea', t, { relleno: false })}</div>`;
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);