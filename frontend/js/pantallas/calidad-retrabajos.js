// Pantalla: Calidad · Retrabajos.
// Unidades que se mandaron a corregir. Se ven las pendientes y las finalizadas. «Revisar» abre el detalle:
// ahí se describe el retrabajo y se marca si quedó Corregido o No corregido. Al guardar, la unidad
// vuelve a Calidad para una nueva inspección.

import { montarPagina, rutaA } from '../layout.js';
import { retrabajos, guardarRetrabajo, opciones } from '../api.js';
import { campo, boton, encabezado, indicador, tarjeta, tabla, chip, aviso, marcarError, cargarEn, mostrarAviso } from '../componentes.js';
import { esc, num, fechaCorta, hoyISO } from '../ui.js';
import { puedeDisponer, dato, radios, abrirDetalle, AVISO_SOLO_CONSULTA } from './calidad-comun.js';

const pagina = montarPagina('calidad/retrabajos');

const HISTORIAL = (serie) => rutaA(`pages/calidad/historial-de-la-unidad.html?serie=${encodeURIComponent(serie)}`);
const RESULTADOS = [
  { valor: 'Corregido', titulo: 'Corregido', ayuda: 'El defecto quedó resuelto.' },
  { valor: 'No corregido', titulo: 'No corregido', ayuda: 'El defecto sigue. Calidad decidirá en la nueva inspección.' },
];

function iniciar(pagina) {
  const { sesion, contenido } = pagina;
  const registrar = puedeDisponer(pagina);

  contenido.innerHTML = `
    ${encabezado(sesion, 'Retrabajos')}
    ${registrar ? '' : `<div class="mt-4">${aviso('info', AVISO_SOLO_CONSULTA)}</div>`}
    <div id="filtros" class="mt-4"></div>
    <div id="resultado" class="mt-4"></div>`;

  const zonaFiltros = document.getElementById('filtros');
  const zonaResultado = document.getElementById('resultado');
  const leerFiltros = () => ({
    q: document.getElementById('q').value.trim(),
    linea: document.getElementById('linea').value,
    modelo: document.getElementById('modelo').value,
    fecha: document.getElementById('fecha').value,
    estado: document.getElementById('estado').value,
  });

  const cargarResultado = () =>
    cargarEn(zonaResultado, async () => {
      const datos = await retrabajos(leerFiltros());
      return { html: htmlRetrabajos(datos, registrar), listo: () => conectarFilas(datos.filas, registrar, cargarResultado) };
    });

  cargarEn(zonaFiltros, async () => {
    const op = await opciones('calidad');
    return {
      html: `
        <form id="form-filtros" class="tarjeta flex flex-wrap items-end gap-3 p-3" aria-label="Filtros de retrabajos" role="search" novalidate>
          ${campo({ id: 'q', etiqueta: 'Buscar unidad', tipo: 'search', placeholder: 'Escanea o escribe la serie', extra: 'autocomplete="off"', clase: 'w-64' })}
          ${campo({ id: 'linea', etiqueta: 'Línea', opciones: [{ valor: '', texto: 'Todas' }, ...op.lineas], clase: 'w-32' })}
          ${campo({ id: 'modelo', etiqueta: 'Modelo', opciones: [{ valor: '', texto: 'Todos' }, ...op.modelos], clase: 'w-40' })}
          ${campo({ id: 'fecha', etiqueta: 'Fecha detectado', tipo: 'date', extra: `max="${hoyISO()}"`, clase: 'w-44' })}
          ${campo({ id: 'estado', etiqueta: 'Estado', opciones: [{ valor: '', texto: 'Todos' }, { valor: 'Pendiente', texto: 'Pendientes' }, { valor: 'Finalizado', texto: 'Finalizados' }], clase: 'w-40' })}
          ${boton('Filtrar', { enviar: true })}
          ${boton('Limpiar filtros', { tipo: 'secundario', id: 'limpiar' })}
        </form>`,
      listo: () => {
        document.getElementById('form-filtros').addEventListener('submit', (e) => {
          e.preventDefault();
          cargarResultado();
        });
        ['linea', 'modelo', 'fecha', 'estado'].forEach((id) => document.getElementById(id).addEventListener('change', cargarResultado));
        document.getElementById('limpiar').addEventListener('click', () => {
          ['q', 'linea', 'modelo', 'fecha', 'estado'].forEach((id) => (document.getElementById(id).value = ''));
          cargarResultado();
        });
        cargarResultado();
      },
    };
  });
}

// ---------------------------------------------------------------- Lista
function htmlRetrabajos({ filas, resumen }, registrar) {
  const t = tabla({
    filas,
    vacio: 'No hay retrabajos con estos filtros',
    detalleVacio: 'Prueba con otra línea, otro modelo, otra fecha u otro estado, o limpia los filtros.',
    columnas: [
      { titulo: 'Unidad', html: (u) => `<strong class="tabular-nums">${esc(u.serie)}</strong>` },
      { titulo: 'Modelo', campo: 'modelo' },
      { titulo: 'Lote', campo: 'lote' },
      { titulo: 'Línea', campo: 'linea' },
      { titulo: 'Fecha', texto: (u) => fechaCorta(u.fecha) },
      { titulo: 'Estado', html: (u) => chip(u.estado === 'Pendiente' ? 'Pendiente' : 'Finalizado', u.estado === 'Pendiente' ? 'aviso' : 'exito') },
      { titulo: 'Defecto / motivo', html: (u) => `${esc(u.motivo)}<span class="block text-xs text-suave">${esc(u.categoria)}</span>` },
      {
        titulo: 'Acción',
        html: (u) => {
          const pendiente = u.estado === 'Pendiente';
          const texto = pendiente && registrar ? 'Revisar' : 'Ver';
          return `<div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn ${pendiente && registrar ? 'btn-principal' : 'btn-secundario'} h-8 px-3" data-revisar="${esc(u.serie)}" aria-label="${texto} ${esc(u.serie)}">${texto}</button>
            <a class="btn btn-enlace" href="${HISTORIAL(u.serie)}">Historial</a></div>`;
        },
      },
    ],
  });

  return `
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${indicador({ titulo: 'Pendientes', valor: num(resumen.pendientes), nota: 'esperan retrabajo', tono: 'retrabajo' })}
      ${indicador({ titulo: 'Finalizadas', valor: num(resumen.finalizadas), nota: 'retrabajo ya registrado', tono: 'exito' })}
    </div>
    <div class="mt-4">${tarjeta(`Unidades en retrabajo (${num(filas.length)})`, t, { relleno: false })}</div>`;
}

function conectarFilas(filas, registrar, recargar) {
  document.querySelectorAll('[data-revisar]').forEach((b) =>
    b.addEventListener('click', () => abrirRetrabajo(filas.find((u) => u.serie === b.dataset.revisar), registrar, recargar)),
  );
}

// ---------------------------------------------------------------- Detalle y registro del retrabajo
function abrirRetrabajo(u, registrar, recargar) {
  const pendiente = u.estado === 'Pendiente';
  const editable = pendiente && registrar;

  const original = `
    <h3 class="mt-4 text-sm font-semibold">Defecto original de la unidad</h3>
    <dl class="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3">
      ${dato('Unidad', `<span class="tabular-nums">${esc(u.serie)}</span>`)}
      ${dato('Modelo', esc(`${u.modelo} · ${u.color}`))}
      ${dato('Categoría', esc(u.categoria))}
      ${dato('Lote', esc(u.lote))}
      ${dato('Defecto', esc(u.motivo))}
      ${dato('Causa', esc(u.causa))}
      ${dato('Línea', esc(u.linea))}
      ${dato('Turno', `Turno ${esc(u.turno)}`)}
      ${dato('Fecha detectado', esc(fechaCorta(u.fecha)))}
      ${dato('Fecha de retrabajo', pendiente ? 'Hoy' : esc(fechaCorta(u.fechaRetrabajo)))}
    </dl>`;

  const retrabajo = editable
    ? `<form id="form-retrabajo" class="mt-5" novalidate>
         ${campo({ id: 'descripcion', etiqueta: 'Descripción del retrabajo', tipo: 'textarea', requerido: true, ayuda: 'Qué se hizo para corregir el defecto.' })}
         <fieldset class="mt-4">
           <legend class="etiqueta">Resultado del retrabajo <span class="text-peligro" aria-hidden="true">*</span></legend>
           ${radios('resultado', RESULTADOS)}
           <p id="resultado-error" class="texto-error hidden" role="alert"></p>
         </fieldset>
         <div class="mt-4">${campo({ id: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', ayuda: 'Opcional.' })}</div>
         <div class="mt-5 flex justify-end gap-2">
           ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar' })}
           ${boton('Guardar y enviar a revisión', { enviar: true, id: 'guardar' })}
         </div>
       </form>`
    : `<h3 class="mt-5 text-sm font-semibold">Retrabajo</h3>
       ${
         pendiente
           ? `<div class="mt-2">${aviso('info', 'Este retrabajo todavía no se registra. Lo registra el Inspector de Calidad.')}</div>`
           : `<dl class="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3">
                ${dato('Resultado', chip(u.resultado, u.resultado === 'Corregido' ? 'exito' : 'peligro'))}
                ${dato('Descripción', esc(u.descripcion))}
                ${dato('Observaciones', esc(u.observaciones))}
              </dl>`
       }
       <div class="mt-5 flex justify-end gap-2"><a class="btn btn-enlace self-center" href="${HISTORIAL(u.serie)}">Ver historial</a>${boton('Cerrar', { tipo: 'secundario', id: 'cancelar' })}</div>`;

  const { dialogo, cerrar } = abrirDetalle({ titulo: 'Detalle de unidad en retrabajo', html: original + retrabajo });
  dialogo.querySelector('#cancelar').addEventListener('click', cerrar);
  if (!editable) return;

  dialogo.querySelector('#descripcion').addEventListener('input', () => marcarError('descripcion', ''));
  dialogo.querySelectorAll('input[name="resultado"]').forEach((r) => r.addEventListener('change', () => dialogo.querySelector('#resultado-error').classList.add('hidden')));
  dialogo.querySelector('#form-retrabajo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const descripcion = dialogo.querySelector('#descripcion').value.trim();
    const resultado = dialogo.querySelector('input[name="resultado"]:checked')?.value || '';
    const observaciones = dialogo.querySelector('#observaciones').value.trim();
    const errorResultado = dialogo.querySelector('#resultado-error');
    marcarError('descripcion', descripcion ? '' : 'Describe el retrabajo que se hizo.');
    errorResultado.textContent = resultado ? '' : 'Elige el resultado del retrabajo.';
    errorResultado.classList.toggle('hidden', Boolean(resultado));
    if (!descripcion || !resultado) return;

    const b = dialogo.querySelector('#guardar');
    b.disabled = true;
    b.textContent = 'Guardando…';
    try {
      await guardarRetrabajo(u.serie, { descripcion, resultado, observaciones });
      cerrar();
      mostrarAviso(`Retrabajo de ${u.serie} registrado como «${resultado}». La unidad volvió a inspección.`);
      recargar();
    } catch (error) {
      mostrarAviso(error.message, 'peligro');
      b.disabled = false;
      b.textContent = 'Guardar y enviar a revisión';
    }
  });
}

if (pagina) iniciar(pagina);
