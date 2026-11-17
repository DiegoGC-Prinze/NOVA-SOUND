// Pantalla: Calidad · Retenciones.
// Unidades que están apartadas (estado «En retención»). Una unidad retenida no puede pasar a empaque
// hasta que Calidad registre una disposición: liberarla, enviarla a retrabajo, mantenerla o mandarla a scrap.
// «Revisar» abre el detalle de la unidad y ahí se da la disposición.

import { montarPagina, rutaA } from '../layout.js';
import { retenciones, resolverRetencion, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, aviso, marcarError, cargarEn, mostrarAviso, preguntar } from '../componentes.js';
import { esc, num, fechaCorta, hoyISO } from '../ui.js';
import { puedeDisponer, dato, radios, abrirDetalle, AVISO_SOLO_CONSULTA, ETIQUETA_DISPOSICION } from './calidad-comun.js';

const pagina = montarPagina('calidad/retenciones');

const HISTORIAL = (serie) => rutaA(`pages/calidad/historial-de-la-unidad.html?serie=${encodeURIComponent(serie)}`);
const DISPOSICIONES = [
  { valor: 'LIBERADA', titulo: 'Liberar', ayuda: 'La unidad pasa a Liberada y ya puede empacarse.' },
  { valor: 'RETRABAJO', titulo: 'Enviar a retrabajo', ayuda: 'Se corrige y después vuelve a inspección.' },
  { valor: 'EN_RETENCION', titulo: 'Mantener en retención', ayuda: 'Sigue apartada. Puedes dejar una nota.' },
  { valor: 'SCRAP', titulo: 'Scrap', ayuda: 'Se desecha. No se puede deshacer.' },
];

function iniciar(pagina) {
  const { sesion, contenido } = pagina;
  const disponer = puedeDisponer(pagina);

  contenido.innerHTML = `
    ${encabezado(sesion, 'Retenciones')}
    ${disponer ? '' : `<div class="mt-4">${aviso('info', AVISO_SOLO_CONSULTA)}</div>`}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  const leerFiltros = () => ({
    q: document.getElementById('q').value.trim(),
    linea: document.getElementById('linea').value,
    modelo: document.getElementById('modelo').value,
    fecha: document.getElementById('fecha').value,
  });

  const cargarResultado = () =>
    cargarEn(zonaResultado, async () => {
      const datos = await retenciones(leerFiltros());
      return { html: htmlRetenciones(datos, disponer), listo: () => conectarFilas(datos.filas, disponer, cargarResultado) };
    });

  cargarEn(zonaFiltros, async () => {
    const op = await opciones('calidad');
    return {
      html: `
        <form id="form-filtros" class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros de retenciones" role="search" novalidate>
          ${campo({ id: 'q', etiqueta: 'Buscar unidad', tipo: 'search', placeholder: 'Escanea o escribe la serie', extra: 'autocomplete="off"', clase: 'w-64' })}
          ${campo({ id: 'linea', etiqueta: 'Línea', opciones: [{ valor: '', texto: 'Todas' }, ...op.lineas], clase: 'w-32' })}
          ${campo({ id: 'modelo', etiqueta: 'Modelo', opciones: [{ valor: '', texto: 'Todos' }, ...op.modelos], clase: 'w-40' })}
          ${campo({ id: 'fecha', etiqueta: 'Fecha de retención', tipo: 'date', extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${boton('Filtrar', { enviar: true })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
        </form>`,
      listo: () => {
        document.getElementById('form-filtros').addEventListener('submit', (e) => {
          e.preventDefault();
          cargarResultado();
        });
        ['linea', 'modelo', 'fecha'].forEach((id) => document.getElementById(id).addEventListener('change', cargarResultado));
        document.getElementById('limpiar').addEventListener('click', () => {
          ['q', 'linea', 'modelo', 'fecha'].forEach((id) => (document.getElementById(id).value = ''));
          cargarResultado();
        });
        cargarResultado();
      },
    };
  });
}

// ---------------------------------------------------------------- Lista
function htmlRetenciones({ filas, resumen }, disponer) {
  const t = tabla({
    filas,
    vacio: 'No hay unidades en retención con estos filtros',
    detalleVacio: 'Prueba con otra línea, otro modelo u otra fecha, o limpia los filtros.',
    columnas: [
      { titulo: 'Unidad', html: (u) => `<strong class="tabular-nums">${esc(u.serie)}</strong>` },
      { titulo: 'Modelo', campo: 'modelo' },
      { titulo: 'Lote', campo: 'lote' },
      { titulo: 'Línea', campo: 'linea' },
      { titulo: 'Fecha', texto: (u) => `${fechaCorta(u.fecha)} ${u.hora}` },
      { titulo: 'Inspector', campo: 'inspector' },
      { titulo: 'Defecto / motivo', html: (u) => `${esc(u.motivo)}<span class="block text-xs text-suave">${esc(u.categoria)}</span>` },
      {
        titulo: 'Acción',
        html: (u) => `<div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn ${disponer ? 'btn-principal' : 'btn-secundario'} h-8 px-3" data-revisar="${esc(u.serie)}" aria-label="${disponer ? 'Revisar' : 'Ver'} ${esc(u.serie)}">${disponer ? 'Revisar' : 'Ver'}</button>
          <a class="btn btn-enlace" href="${HISTORIAL(u.serie)}">Historial</a></div>`,
      },
    ],
  });

  return `
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${indicador({ titulo: 'Retenidas', valor: num(resumen.retenidas), nota: 'unidades apartadas ahora', tono: 'aviso' })}
      ${indicador({ titulo: 'Retenidas hoy', valor: num(resumen.retenidasHoy), nota: 'se detectaron hoy', tono: 'marca' })}
    </div>
    <div class="mt-4">${tarjeta(`Unidades en retención (${num(filas.length)})`, t, { relleno: false })}</div>`;
}

function conectarFilas(filas, disponer, recargar) {
  document.querySelectorAll('[data-revisar]').forEach((b) =>
    b.addEventListener('click', () => abrirRevision(filas.find((u) => u.serie === b.dataset.revisar), disponer, recargar)),
  );
}

// ---------------------------------------------------------------- Detalle y disposición
function abrirRevision(u, disponer, recargar) {
  const datos = `
    <dl class="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
      ${dato('Unidad', `<span class="tabular-nums">${esc(u.serie)}</span>`)}
      ${dato('Modelo', esc(`${u.modelo} · ${u.color}`))}
      ${dato('Lote', esc(u.lote))}
      ${dato('Línea', esc(u.linea))}
      ${dato('Turno', `Turno ${esc(u.turno)}`)}
      ${dato('Fecha de retención', esc(`${fechaCorta(u.fecha)} ${u.hora}`))}
      ${dato('Inspector', esc(u.inspector))}
      ${dato('Motivo', `${esc(u.motivo)} <span class="text-xs font-normal text-suave">(${esc(u.categoria)})</span>`)}
      ${dato('Observaciones', esc(u.observaciones))}
    </dl>`;

  const formulario = disponer
    ? `<form id="form-disposicion" class="mt-5" novalidate>
         <fieldset>
           <legend class="etiqueta">Disposición de la unidad</legend>
           ${radios('disposicion', DISPOSICIONES, { seleccionada: 'EN_RETENCION' })}
         </fieldset>
         <div class="mt-4">${campo({ id: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', ayuda: 'Obligatorias para liberar, enviar a retrabajo o mandar a scrap: queda quién, cuándo y por qué.' })}</div>
         <div class="mt-5 flex justify-end gap-2">
           ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar' })}
           ${boton('Guardar disposición', { enviar: true, id: 'guardar' })}
         </div>
       </form>`
    : `<div class="mt-5 flex justify-end gap-2"><a class="btn btn-enlace self-center" href="${HISTORIAL(u.serie)}">Ver historial</a>${boton('Cerrar', { tipo: 'secundario', id: 'cancelar' })}</div>`;

  const { dialogo, cerrar } = abrirDetalle({ titulo: 'Detalle de unidad en retención', html: datos + formulario });
  dialogo.querySelector('#cancelar').addEventListener('click', cerrar);
  if (!disponer) return;

  dialogo.querySelector('#observaciones').addEventListener('input', () => marcarError('observaciones', ''));
  dialogo.querySelector('#form-disposicion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const disposicion = dialogo.querySelector('input[name="disposicion"]:checked')?.value;
    const observaciones = dialogo.querySelector('#observaciones').value.trim();
    marcarError('observaciones', '');

    if (disposicion === 'EN_RETENCION' && !observaciones) return mostrarAviso('No hay cambios que guardar: la unidad sigue en retención.', 'info');
    if (disposicion !== 'EN_RETENCION' && !observaciones) return marcarError('observaciones', 'Escribe las observaciones de la disposición.');
    if (disposicion === 'SCRAP') {
      const ok = await preguntar({ titulo: '¿Mandar la unidad a scrap?', mensaje: `${u.serie} se desecha y ya no podrá empacarse. Esto no se puede deshacer.`, textoOk: 'Mandar a scrap', tipoOk: 'peligro' });
      if (!ok) return;
    }

    const b = dialogo.querySelector('#guardar');
    b.disabled = true;
    b.textContent = 'Guardando…';
    try {
      await resolverRetencion(u.serie, { disposicion, observaciones });
      cerrar();
      mostrarAviso(disposicion === 'EN_RETENCION' ? `Se guardó la nota de ${u.serie}; sigue en retención.` : `${u.serie} quedó «${ETIQUETA_DISPOSICION[disposicion]}».`);
      recargar();
    } catch (error) {
      mostrarAviso(error.message, 'peligro');
      b.disabled = false;
      b.textContent = 'Guardar disposición';
    }
  });
}

if (pagina) iniciar(pagina);
