// Módulo COMPARTIDO por dos pantallas que muestran lo mismo:
//   - Gerencia · Trazabilidad          (pages/gerencia/trazabilidad.html)
//   - Calidad  · Historial de la unidad (pages/calidad/historial-de-la-unidad.html)
// Es solo consulta: cada pantalla le pasa su id de js/menu.js y se pinta en su propia área.
//
// Se busca por número de serie (escaneado o escrito a mano) y muestra: datos de la unidad,
// recorrido del lote al embarque, historial de eventos y contenido de la caja.

import { montarPagina } from '../layout.js';
import { unidadPorSerie, seriesDeEjemplo, ErrorApi } from '../api.js';
import { boton, encabezado, tarjeta, tabla, chipUnidad, chip, aviso, cargarEn, estadoVacio } from '../componentes.js';
import { esc, fechaCorta, num } from '../ui.js';

export function iniciarHistorial(idPantalla) {
  const pagina = montarPagina(idPantalla);
  if (!pagina) return;
  const { sesion, contenido } = pagina;

  contenido.innerHTML = `
    ${encabezado(sesion, pagina.pantalla.nombre)}
    <form id="form-busqueda" class="tarjeta mt-4 p-4" role="search" novalidate>
      <label class="etiqueta" for="serie">Número de serie</label>
      <div class="flex flex-wrap gap-2">
        <input id="serie" name="serie" type="search" class="campo max-w-md flex-1" placeholder="Escanea el código o escribe la serie" autocomplete="off" autofocus aria-describedby="ayuda-serie">
        ${boton('Buscar', { enviar: true })}
      </div>
      <p id="ayuda-serie" class="mt-1.5 text-xs text-suave">Con un lector, escanea el código y se llenará solo; si no lee, escríbelo a mano.</p>
      <div id="ejemplos" class="mt-3"></div>
    </form>
    <div id="resultado" class="mt-4"></div>`;

  const campoSerie = document.getElementById('serie');
  const zona = document.getElementById('resultado');

  function buscar(serie) {
    const texto = serie.trim();
    if (!texto) {
      zona.innerHTML = `<div class="tarjeta">${estadoVacio('Escribe o escanea un número de serie', 'Aquí aparecerá todo el recorrido de la unidad.')}</div>`;
      return;
    }
    history.replaceState(null, '', `?serie=${encodeURIComponent(texto)}`);
    cargarEn(zona, async () => {
      try {
        return htmlUnidad(await unidadPorSerie(texto));
      } catch (error) {
        if (error instanceof ErrorApi && error.estado === 404) {
          return `<div class="tarjeta">${estadoVacio(error.message, 'Revisa que esté bien escrita o escanéala de nuevo.')}</div>`;
        }
        throw error;
      }
    }, 'Buscando la unidad…');
  }

  document.getElementById('form-busqueda').addEventListener('submit', (e) => {
    e.preventDefault();
    buscar(campoSerie.value);
  });

  // Estado inicial: sin búsqueda, o la serie que venga en la dirección (?serie=…).
  const inicial = new URLSearchParams(location.search).get('serie');
  if (inicial) {
    campoSerie.value = inicial;
    buscar(inicial);
  } else {
    zona.innerHTML = `<div class="tarjeta">${estadoVacio('Busca una unidad para ver su recorrido', 'Escribe o escanea el número de serie.')}</div>`;
  }

  // Solo en modo ejemplo: atajos con series de prueba.
  seriesDeEjemplo().then((lista) => {
    if (!lista.length) return;
    document.getElementById('ejemplos').innerHTML = `
      <p class="mb-1.5 text-xs text-suave">Series de ejemplo (solo para pruebas):</p>
      <div class="flex flex-wrap gap-2">
        ${lista.map((u) => `<button type="button" data-serie="${esc(u.serie)}" class="flex items-center gap-2 rounded-md border border-borde bg-white px-2.5 py-1 text-xs hover:bg-marca-claro"><span class="tabular-nums">${esc(u.serie)}</span>${chipUnidad(u.estado)}</button>`).join('')}
      </div>`;
    document.querySelectorAll('[data-serie]').forEach((b) =>
      b.addEventListener('click', () => {
        campoSerie.value = b.dataset.serie;
        buscar(b.dataset.serie);
      }),
    );
  });
}

// ---------------------------------------------------------------- Recorrido del lote al embarque
const ETAPAS = [
  { nombre: 'Orden', area: null },
  { nombre: 'Ensamble', area: 'Producción', primero: true },
  { nombre: 'Prueba funcional', area: 'Prueba funcional', primero: true },
  { nombre: 'Calidad', area: 'Calidad' },
  { nombre: 'Empaque', area: 'Empaque' },
  { nombre: 'Embarque', area: 'Embarques' },
];

// Cada etapa queda: 'hecha', 'actual' (donde está esperando la unidad), 'pendiente' o 'alerta' (bloqueada en Calidad).
function calcularEtapas(u) {
  // Ensamble y prueba usan su PRIMER evento (después de un retrabajo se repiten); las demás, el último.
  const ultimoDe = (area) => [...u.historial].reverse().find((e) => e.area === area);
  const primeroDe = (area) => u.historial.find((e) => e.area === area);
  const bloqueada = ['EN_RETENCION', 'RETRABAJO', 'SCRAP'].includes(u.estado);
  let actualAsignada = false;

  return ETAPAS.map((etapa, i) => {
    if (i === 0) return { ...etapa, estado: 'hecha', detalle: u.orden, extra: u.cliente };
    const evento = etapa.primero ? primeroDe(etapa.area) : ultimoDe(etapa.area);
    if (etapa.area === 'Calidad' && bloqueada && evento) {
      return { ...etapa, estado: 'alerta', detalle: evento.resultado, extra: `${fechaCorta(evento.fecha)} ${evento.hora}` };
    }
    if (evento && !(etapa.area === 'Calidad' && bloqueada)) {
      return { ...etapa, estado: 'hecha', detalle: evento.resultado, extra: `${fechaCorta(evento.fecha)} ${evento.hora}` };
    }
    if (!actualAsignada && !bloqueada) {
      actualAsignada = true;
      return { ...etapa, estado: 'actual', detalle: 'Aquí está ahora', extra: '' };
    }
    return { ...etapa, estado: 'pendiente', detalle: 'Pendiente', extra: '' };
  });
}

const ICONOS = {
  hecha: { texto: '✓', clases: 'bg-exito text-white', leyenda: 'Hecha' },
  actual: { texto: '●', clases: 'bg-marca text-white ring-4 ring-marca-claro', leyenda: 'En curso' },
  pendiente: { texto: '', clases: 'border-2 border-borde bg-white text-suave', leyenda: 'Pendiente' },
  alerta: { texto: '!', clases: 'bg-aviso text-texto', leyenda: 'Detenida' },
};

function htmlRecorrido(u) {
  const items = calcularEtapas(u)
    .map((e, i) => {
      const icono = ICONOS[e.estado];
      const scrap = u.estado === 'SCRAP' && e.estado === 'alerta';
      return `
        <li class="flex gap-3 md:flex-col md:items-start" aria-label="${esc(e.nombre)}: ${icono.leyenda}">
          <span class="flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-bold ${scrap ? 'bg-peligro text-white' : icono.clases}" aria-hidden="true">${icono.texto || i + 1}</span>
          <div class="min-w-0">
            <p class="text-sm font-semibold">${esc(e.nombre)}</p>
            <p class="text-xs ${e.estado === 'pendiente' ? 'text-suave' : 'text-texto'}">${esc(e.detalle)}</p>
            ${e.extra ? `<p class="text-xs text-suave">${esc(e.extra)}</p>` : ''}
          </div>
        </li>`;
    })
    .join('');
  return `<ol class="grid gap-4 md:grid-cols-6">${items}</ol>`;
}

// ---------------------------------------------------------------- Pintado
function dato(titulo, valor) {
  return `<div><dt class="text-xs text-suave">${esc(titulo)}</dt><dd class="mt-0.5 font-medium">${valor}</dd></div>`;
}

function htmlCaja(u) {
  if (!u.caja) {
    return aviso('info', 'Esta unidad todavía no está en una caja.');
  }
  const c = u.caja;
  const embarque = u.embarque
    ? `${dato('Embarque', esc(u.embarque.referencia))}${dato('Cliente', esc(u.embarque.cliente))}${dato('Fecha de salida', esc(fechaCorta(u.embarque.fechaSalida)))}`
    : dato('Embarque', '<span class="text-suave">Aún no embarcada</span>');
  const series = c.unidades
    .map((s) => `<li class="rounded-md border px-2.5 py-1 text-xs tabular-nums ${s === u.serie ? 'border-marca bg-marca-claro font-semibold text-marca-osc' : 'border-borde bg-white'}">${esc(s)}${s === u.serie ? ' · esta unidad' : ''}</li>`)
    .join('');
  return `
    <dl class="grid grid-cols-2 gap-4 md:grid-cols-4">
      ${dato('Caja', esc(c.id))}
      ${dato('Estado', chip(c.estado, c.estado === 'Cerrada' ? 'exito' : 'aviso'))}
      ${dato('Unidades', `${num(c.unidades.length)} de ${num(c.capacidad)}`)}
      ${embarque}
    </dl>
    <ul class="mt-4 flex flex-wrap gap-2" aria-label="Series dentro de la caja">${series}</ul>`;
}

function htmlUnidad(u) {
  const datos = `
    <dl class="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
      ${dato('Serie', `<span class="tabular-nums">${esc(u.serie)}</span>`)}
      ${dato('Estado actual', chipUnidad(u.estado))}
      ${dato('Modelo', esc(u.modelo))}
      ${dato('Color', esc(u.color))}
      ${dato('Cliente', esc(u.cliente))}
      ${dato('Orden', esc(u.orden))}
      ${dato('Lote', esc(u.lote))}
      ${dato('Línea', esc(u.linea))}
      ${dato('Turno', `Turno ${esc(u.turno)}`)}
      ${dato('Producida', esc(`${fechaCorta(u.fecha)} ${u.hora}`))}
    </dl>`;

  const historial = tabla({
    filas: u.historial,
    vacio: 'Esta unidad todavía no tiene eventos.',
    columnas: [
      { titulo: 'Fecha', texto: (e) => fechaCorta(e.fecha) },
      { titulo: 'Hora', texto: (e) => e.hora },
      { titulo: 'Área', campo: 'area' },
      { titulo: 'Evento', campo: 'evento' },
      { titulo: 'Resultado', campo: 'resultado' },
      { titulo: 'Usuario', campo: 'usuario' },
    ],
  });

  return `
    ${tarjeta('Datos de la unidad', datos)}
    <div class="mt-4">${tarjeta('Recorrido del lote al embarque', htmlRecorrido(u))}</div>
    <div class="mt-4">${tarjeta('Historial', historial, { relleno: false })}</div>
    <div class="mt-4">${tarjeta('Contenido de la caja', htmlCaja(u))}</div>`;
}
