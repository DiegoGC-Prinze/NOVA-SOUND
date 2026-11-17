// Pantalla: Calidad · Inspección de unidad.
// Se escanea o escribe la serie de una unidad que ya pasó la prueba funcional, se revisa su información,
// se registran los defectos (si hay) y se da la disposición: Liberada, En retención, Retrabajo o Scrap.
// Reglas: para liberar no puede haber defectos; para las demás disposiciones, al menos uno.
// Se puede llegar con ?serie=… desde «Unidades pendientes de inspección» del Resumen.

import { montarPagina, rutaA } from '../layout.js';
import { unidadPorSerie, guardarInspeccion, catalogos, ErrorApi } from '../api.js';
import { boton, encabezado, tarjeta, tabla, chip, chipUnidad, campo, marcarError, aviso, cargarEn, estadoVacio, mostrarAviso, preguntar } from '../componentes.js';
import { esc } from '../ui.js';
import { puedeDisponer, dato, defectosPorCategoria, radios, AVISO_SOLO_CONSULTA, ETIQUETA_DISPOSICION } from './calidad-comun.js';

const pagina = montarPagina('calidad/inspeccion-de-unidad');

const HISTORIAL = (serie) => rutaA(`pages/calidad/historial-de-la-unidad.html?serie=${encodeURIComponent(serie)}`);
const OTRA_PANTALLA = {
  EN_RETENCION: ['Retenciones', 'pages/calidad/retenciones.html', 'Esta unidad está en retención. Su disposición se da desde Retenciones.'],
  RETRABAJO: ['Retrabajos', 'pages/calidad/retrabajos.html', 'Esta unidad está en retrabajo. Cuando se registre el retrabajo, volverá aquí para una nueva inspección.'],
};
const DISPOSICIONES = [
  { valor: 'LIBERADA', titulo: 'Liberada', ayuda: 'Sin defectos. Ya puede pasar a empaque.' },
  { valor: 'EN_RETENCION', titulo: 'En retención', ayuda: 'Se aparta hasta decidir qué hacer.' },
  { valor: 'RETRABAJO', titulo: 'Retrabajo', ayuda: 'Se corrige y vuelve a inspección.' },
  { valor: 'SCRAP', titulo: 'Scrap', ayuda: 'Se desecha. No se puede deshacer.' },
];

function iniciar(pagina) {
  const { sesion, contenido } = pagina;
  const disponer = puedeDisponer(pagina);

  contenido.innerHTML = `
    ${encabezado(sesion, 'Inspección de unidad')}
    ${disponer ? '' : `<div class="mt-4">${aviso('info', AVISO_SOLO_CONSULTA)}</div>`}
    <form id="form-busqueda" class="tarjeta mt-4 p-4" role="search" novalidate>
      <label class="etiqueta" for="serie">Número de serie</label>
      <div class="flex flex-wrap gap-2">
        <input id="serie" name="serie" type="search" class="campo max-w-md flex-1" placeholder="Escanea el código o escribe la serie" autocomplete="off" autofocus aria-describedby="ayuda-serie">
        ${boton('Buscar', { enviar: true })}
      </div>
      <p id="ayuda-serie" class="mt-1.5 text-xs text-suave">Con un lector, escanea el código y se llenará solo. Solo se inspeccionan unidades que ya pasaron la prueba funcional.</p>
    </form>
    <div id="resultado" class="mt-4"></div>`;

  const campoSerie = document.getElementById('serie');
  const zona = document.getElementById('resultado');
  const vacio = () => `<div class="tarjeta">${estadoVacio('Escribe o escanea un número de serie', 'Aquí aparecerá la unidad para inspeccionarla.')}</div>`;

  // Después de guardar o cancelar: se limpia todo para inspeccionar la siguiente unidad.
  function reiniciar() {
    campoSerie.value = '';
    history.replaceState(null, '', location.pathname);
    zona.innerHTML = vacio();
    campoSerie.focus();
  }

  function buscar(serie) {
    const texto = serie.trim();
    if (!texto) {
      zona.innerHTML = vacio();
      return;
    }
    history.replaceState(null, '', `?serie=${encodeURIComponent(texto)}`);
    cargarEn(
      zona,
      async () => {
        try {
          const u = await unidadPorSerie(texto);
          if (u.estado !== 'PROBADA') return htmlNoInspeccionable(u);
          const porCategoria = defectosPorCategoria(await catalogos('calidad'));
          return { html: htmlInspeccion(u, disponer, Object.keys(porCategoria)), listo: () => conectar(u, porCategoria, disponer, reiniciar) };
        } catch (error) {
          if (error instanceof ErrorApi && error.estado === 404) {
            return `<div class="tarjeta">${estadoVacio(error.message, 'Revisa que esté bien escrita o escanéala de nuevo.')}</div>`;
          }
          throw error;
        }
      },
      'Buscando la unidad…',
    );
  }

  document.getElementById('form-busqueda').addEventListener('submit', (e) => {
    e.preventDefault();
    buscar(campoSerie.value);
  });

  const inicial = new URLSearchParams(location.search).get('serie');
  if (inicial) {
    campoSerie.value = inicial;
    buscar(inicial);
  } else {
    zona.innerHTML = vacio();
  }
}

// ---------------------------------------------------------------- Unidad que no se puede inspeccionar
function htmlNoInspeccionable(u) {
  const otra = OTRA_PANTALLA[u.estado];
  const mensaje = otra ? otra[2] : u.estado === 'SCRAP' ? 'Esta unidad ya es scrap.' : 'Esta unidad ya fue inspeccionada y no necesita otra inspección.';
  return `
    <div class="tarjeta p-5">
      <div class="flex flex-wrap items-center gap-2"><strong class="tabular-nums">${esc(u.serie)}</strong>${chipUnidad(u.estado)}</div>
      <p class="mt-2 text-sm">${esc(mensaje)}</p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        ${otra ? `<a class="btn btn-secundario" href="${rutaA(otra[1])}">Ir a ${esc(otra[0])}</a>` : ''}
        <a class="btn btn-enlace" href="${HISTORIAL(u.serie)}">Ver historial de la unidad</a>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- Formulario de inspección
function htmlInspeccion(u, disponer, categorias) {
  const datos = `
    <dl class="grid grid-cols-2 gap-4 md:grid-cols-4">
      ${dato('Unidad', `<span class="tabular-nums">${esc(u.serie)}</span>`)}
      ${dato('Modelo', esc(u.modelo))}
      ${dato('Color', esc(u.color))}
      ${dato('Estado actual', chipUnidad(u.estado))}
      ${dato('Orden', esc(u.orden))}
      ${dato('Lote', esc(u.lote))}
      ${dato('Línea', esc(u.linea))}
      ${dato('Turno', `Turno ${esc(u.turno)}`)}
    </dl>`;

  const pruebas = [
    ['Encendido', u.prueba?.encendido],
    ['Audio', u.prueba?.audio],
    ['Carga', u.prueba?.carga],
    ['Bluetooth', u.prueba?.bluetooth],
  ];
  const resultadosPrueba = `<ul class="flex flex-wrap gap-3">${pruebas
    .map(([nombre, resultado]) => `<li class="flex items-center gap-2 rounded-md border border-borde bg-white px-3 py-1.5 text-sm"><span>${esc(nombre)}</span>${chip(resultado || 'Sin dato', resultado === 'Aprobada' ? 'exito' : resultado ? 'peligro' : 'neutro')}</li>`)
    .join('')}</ul>`;

  const editor = `
    <div class="grid gap-3 md:grid-cols-[13rem_17rem_1fr_auto] md:items-start">
      ${campo({ id: 'categoria', etiqueta: 'Categoría', opciones: [{ valor: '', texto: 'Elige una categoría' }, ...categorias] })}
      ${campo({ id: 'defecto', etiqueta: 'Defecto', opciones: [{ valor: '', texto: 'Primero la categoría' }] })}
      ${campo({ id: 'causa', etiqueta: 'Causa (opcional)', extra: 'autocomplete="off" maxlength="120"' })}
      <div class="md:pt-5">${boton('Agregar', { tipo: 'secundario', id: 'agregar-defecto' })}</div>
    </div>
    <div id="lista-defectos" class="mt-3"></div>`;

  const disposicion = `
    <fieldset>
      <legend class="etiqueta">Disposición de la unidad <span class="text-peligro" aria-hidden="true">*</span></legend>
      ${radios('disposicion', DISPOSICIONES)}
      <p id="disposicion-error" class="texto-error hidden" role="alert"></p>
    </fieldset>
    <div class="mt-4">${campo({ id: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', ayuda: 'Opcional. Para scrap es obligatoria.' })}</div>
    <div class="mt-5 flex justify-end gap-2">
      ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar' })}
      ${boton('Guardar inspección', { enviar: true, id: 'guardar' })}
    </div>`;

  return `
    <form id="form-inspeccion" class="max-w-5xl space-y-4" novalidate>
      ${tarjeta('Datos de la unidad', datos)}
      ${tarjeta('Resultados de la prueba funcional', resultadosPrueba)}
      ${disponer ? tarjeta('Defectos detectados', editor) : ''}
      ${disponer ? tarjeta('Disposición', disposicion) : `<div class="flex justify-end"><a class="btn btn-secundario" href="${HISTORIAL(u.serie)}">Ver historial de la unidad</a></div>`}
    </form>`;
}

function conectar(u, porCategoria, disponer, reiniciar) {
  if (!disponer) return; // solo consulta: no hay nada que guardar

  const $ = (id) => document.getElementById(id);
  const categoria = $('categoria');
  const defecto = $('defecto');
  const defectos = [];

  categoria.addEventListener('change', () => {
    const lista = porCategoria[categoria.value] || [];
    defecto.innerHTML = categoria.value
      ? `<option value="">Elige un defecto</option>${lista.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`
      : '<option value="">Primero la categoría</option>';
    marcarError('categoria', '');
  });

  function pintarDefectos() {
    $('lista-defectos').innerHTML = defectos.length
      ? tabla({
          filas: defectos,
          columnas: [
            { titulo: 'Categoría', campo: 'categoria' },
            { titulo: 'Defecto', html: (d) => `<strong>${esc(d.defecto)}</strong>` },
            { titulo: 'Causa', texto: (d) => d.causa || '—' },
            { titulo: '', html: (d, i) => `<button type="button" class="btn btn-secundario h-8 px-3" data-quitar="${i}" aria-label="Eliminar ${esc(d.defecto)}">Eliminar</button>` },
          ],
        })
      : '<p class="text-sm text-suave">Sin defectos registrados. Si la unidad está bien, elige «Liberada».</p>';
    $('lista-defectos')
      .querySelectorAll('[data-quitar]')
      .forEach((b) =>
        b.addEventListener('click', () => {
          defectos.splice(Number(b.dataset.quitar), 1);
          pintarDefectos();
        }),
      );
  }

  function agregarDefecto() {
    marcarError('categoria', categoria.value ? '' : 'Elige la categoría.');
    marcarError('defecto', defecto.value ? '' : 'Elige el defecto.');
    if (!categoria.value || !defecto.value) return;
    if (defectos.some((d) => d.defecto === defecto.value)) return marcarError('defecto', 'Ese defecto ya está en la lista.');
    defectos.push({ categoria: categoria.value, defecto: defecto.value, causa: $('causa').value.trim() });
    categoria.value = '';
    defecto.innerHTML = '<option value="">Primero la categoría</option>';
    $('causa').value = '';
    $('disposicion-error').classList.add('hidden');
    pintarDefectos();
    categoria.focus();
  }

  $('agregar-defecto').addEventListener('click', agregarDefecto);
  // Enter en «Causa» agrega el defecto en lugar de guardar toda la inspección.
  $('causa').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      agregarDefecto();
    }
  });
  $('cancelar').addEventListener('click', reiniciar);
  pintarDefectos();

  const errorDisposicion = (mensaje) => {
    const p = $('disposicion-error');
    p.textContent = mensaje;
    p.classList.toggle('hidden', !mensaje);
    return false;
  };
  // Los mensajes de error se quitan en cuanto la persona corrige.
  defecto.addEventListener('change', () => marcarError('defecto', ''));
  $('observaciones').addEventListener('input', () => marcarError('observaciones', ''));
  document.querySelectorAll('input[name="disposicion"]').forEach((r) => r.addEventListener('change', () => errorDisposicion('')));

  $('form-inspeccion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const disposicion = document.querySelector('input[name="disposicion"]:checked')?.value || '';
    const observaciones = $('observaciones').value.trim();
    errorDisposicion('');
    marcarError('observaciones', '');

    if (!disposicion) return errorDisposicion('Elige la disposición de la unidad.');
    if (disposicion === 'LIBERADA' && defectos.length) return errorDisposicion('Una unidad con defectos no se puede liberar. Quita los defectos o elige otra disposición.');
    if (disposicion !== 'LIBERADA' && !defectos.length) return errorDisposicion('Agrega al menos un defecto para esa disposición.');
    if (disposicion === 'SCRAP') {
      if (!observaciones) return marcarError('observaciones', 'Escribe por qué la unidad se manda a scrap.');
      const ok = await preguntar({ titulo: '¿Mandar la unidad a scrap?', mensaje: `${u.serie} se desecha y ya no podrá empacarse. Esto no se puede deshacer.`, textoOk: 'Mandar a scrap', tipoOk: 'peligro' });
      if (!ok) return;
    }

    const b = $('guardar');
    b.disabled = true;
    b.textContent = 'Guardando…';
    try {
      await guardarInspeccion(u.serie, { defectos, observaciones, disposicion });
      mostrarAviso(`Inspección guardada: ${u.serie} quedó «${ETIQUETA_DISPOSICION[disposicion]}».`);
      reiniciar();
    } catch (error) {
      mostrarAviso(error.message, 'peligro');
      b.disabled = false;
      b.textContent = 'Guardar inspección';
    }
  });
}

if (pagina) iniciar(pagina);
