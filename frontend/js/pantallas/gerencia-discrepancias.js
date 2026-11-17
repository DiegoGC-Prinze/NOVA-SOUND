// Pantalla: Gerencia · Discrepancias.
// Compara lo que Producción reportó, lo que Calidad liberó y lo que Almacén recibió,
// y muestra por lote (o por línea o modelo) dónde se pierden las unidades.

import { montarPagina } from '../layout.js';
import { discrepancias, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, aviso, cargarEn, estadoVacio } from '../componentes.js';
import { esc, num, pct, pctDe, hoyISO } from '../ui.js';

const pagina = montarPagina('gerencia/discrepancias');

function iniciar({ sesion, contenido }) {
  contenido.innerHTML = `
    ${encabezado(sesion, 'Discrepancias')}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  const leerFiltros = () => ({
    fecha: document.getElementById('fecha').value || hoyISO(),
    turno: document.getElementById('turno').value,
    vista: document.getElementById('vista').value,
  });
  const cargarResultado = () =>
    cargarEn(zonaResultado, async () => htmlDiscrepancias(await discrepancias(leerFiltros())));

  cargarEn(zonaFiltros, async () => {
    const op = await opciones();
    return {
      html: `
        <form class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros de discrepancias" onsubmit="return false">
          ${campo({ id: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: hoyISO(), extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${campo({ id: 'turno', etiqueta: 'Turno', opciones: [{ valor: '', texto: 'Todos' }, ...op.turnos.map((t) => ({ valor: t.valor, texto: t.nombre }))], clase: 'w-52' })}
          ${campo({ id: 'vista', etiqueta: 'Ver por', opciones: [{ valor: 'lote', texto: 'Lote' }, { valor: 'linea', texto: 'Línea' }, { valor: 'modelo', texto: 'Modelo' }], clase: 'w-40' })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
        </form>`,
      listo: () => {
        ['fecha', 'turno', 'vista'].forEach((id) => document.getElementById(id).addEventListener('change', cargarResultado));
        document.getElementById('limpiar').addEventListener('click', () => {
          document.getElementById('fecha').value = hoyISO();
          document.getElementById('turno').value = '';
          document.getElementById('vista').value = 'lote';
          cargarResultado();
        });
        cargarResultado();
      },
    };
  });
}

// Número en rojo cuando hay unidades sin explicar.
const marcar = (n) => (n > 0 ? `<strong class="text-[#8E1B1B]">${num(n)}</strong>` : `<span class="text-suave">0</span>`);

function htmlDiscrepancias(d) {
  const t = d.totales;
  if (!t.reportadas) {
    return `<div class="tarjeta">${estadoVacio('No hay producción en esa fecha', 'Elige otro día o turno.')}</div>`;
  }

  // Tres conteos con la diferencia entre cada paso.
  const flujo = `
    <div class="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
      ${indicador({ titulo: 'Producción reportó', valor: num(t.reportadas), nota: 'unidades buenas', tono: 'marca' })}
      <div class="flex items-center justify-center text-center text-sm lg:w-32"><div><p class="text-lg font-bold tabular-nums ${t.noLiberadas ? 'text-[#8E1B1B]' : 'text-suave'}">− ${num(t.noLiberadas)}</p><p class="text-xs text-suave">no liberadas<br>por Calidad</p></div></div>
      ${indicador({ titulo: 'Calidad liberó', valor: num(t.liberadas), nota: 'unidades liberadas', tono: 'exito' })}
      <div class="flex items-center justify-center text-center text-sm lg:w-32"><div><p class="text-lg font-bold tabular-nums ${t.sinRecibir ? 'text-[#8E1B1B]' : 'text-suave'}">− ${num(t.sinRecibir)}</p><p class="text-xs text-suave">sin recibir<br>en Almacén</p></div></div>
      ${indicador({ titulo: 'Almacén recibió', valor: num(t.recibidas), nota: 'unidades recibidas', tono: 'neutro' })}
    </div>`;

  const mensaje = t.diferencia
    ? aviso('aviso', `Faltan ${num(t.diferencia)} unidades entre lo que Producción reportó y lo que Almacén recibió (${pct(pctDe(t.diferencia, t.reportadas))}). ${num(t.noLiberadas)} no fueron liberadas por Calidad y ${num(t.sinRecibir)} fueron liberadas pero Almacén todavía no las recibe.`)
    : aviso('exito', 'Los tres conteos coinciden.');

  const columnasBase = {
    lote: [
      { titulo: 'Lote', html: (f) => `<strong>${esc(f.etiqueta)}</strong>` },
      { titulo: 'Orden', campo: 'orden' },
      { titulo: 'Modelo', campo: 'modelo' },
      { titulo: 'Línea', campo: 'linea' },
    ],
    linea: [{ titulo: 'Línea', html: (f) => `<strong>${esc(f.etiqueta)}</strong>` }],
    modelo: [{ titulo: 'Modelo', html: (f) => `<strong>${esc(f.etiqueta)}</strong>` }],
  }[d.vista];

  const tablaDetalle = tabla({
    filas: d.filas,
    vacio: 'No hay datos para esta vista.',
    columnas: [
      ...columnasBase,
      { titulo: 'Reportadas', num: true, texto: (f) => num(f.reportadas) },
      { titulo: 'Liberadas', num: true, texto: (f) => num(f.liberadas) },
      { titulo: 'Recibidas', num: true, texto: (f) => num(f.recibidas) },
      { titulo: 'No liberadas', num: true, html: (f) => marcar(f.noLiberadas) },
      { titulo: 'Sin recibir', num: true, html: (f) => marcar(f.sinRecibir) },
    ],
  });
  const titulos = { lote: 'Detalle por lote', linea: 'Detalle por línea', modelo: 'Detalle por modelo' };

  return `${flujo}<div class="mt-4">${mensaje}</div><div class="mt-4">${tarjeta(titulos[d.vista], tablaDetalle, { relleno: false })}</div>`;
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
