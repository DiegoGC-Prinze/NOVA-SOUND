// Pantalla: Gerencia · Autorizaciones.
// Solicitudes pendientes (corrección de cierre, reapertura de turno) y las resueltas recientes.
// Quien tiene permiso «Acciona» puede aprobar o rechazar; los demás solo consultan.
// Regla del caso: toda corrección importante guarda quién, cuándo, qué cambió y por qué.

import { montarPagina } from '../layout.js';
import { autorizaciones, resolverAutorizacion } from '../api.js';
import { encabezado, tarjeta, tabla, chip, aviso, cargarEn, estadoVacio, preguntar, mostrarAviso } from '../componentes.js';
import { esc, diaRelativo } from '../ui.js';

const pagina = montarPagina('gerencia/autorizaciones');

const cuando = (fecha, hora) => `${diaRelativo(fecha)} ${hora}`;
const cambioTexto = (c) => (c ? `${c.campo}: ${c.de} → ${c.a}` : '—');

function iniciar({ sesion, contenido, puedeAccionar }) {
  contenido.innerHTML = `
    ${encabezado(sesion, 'Autorizaciones')}
    ${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar las solicitudes. Las aprueban el Subgerente y el Gerente de Producción.')}</div>`}
    <div id="resultado" class="mt-4"></div>`;

  const zona = document.getElementById('resultado');
  const cargar = () =>
    cargarEn(zona, async () => {
      const datos = await autorizaciones();
      return { html: htmlAutorizaciones(datos, puedeAccionar), listo: () => conectarBotones(datos, cargar) };
    });
  cargar();
}

function tarjetaPendiente(a, puedeAccionar) {
  const tipoChip = chip(a.tipo, a.tipo === 'Reapertura de turno' ? 'aviso' : 'info');
  return `
    <article class="tarjeta p-4" aria-label="${esc(a.tipo)} ${esc(a.linea)} turno ${esc(a.turno)}">
      <div class="flex flex-wrap items-center gap-2">
        ${tipoChip}
        <span class="font-semibold">Línea ${esc(a.linea)} · Turno ${esc(a.turno)}</span>
        <span class="ml-auto text-xs text-suave">${esc(cuando(a.fecha, a.hora))}</span>
      </div>
      ${a.cambio ? `<p class="mt-3 rounded-md bg-fondo px-3 py-2 text-sm"><span class="text-suave">Cambio solicitado · </span><strong>${esc(cambioTexto(a.cambio))}</strong></p>` : ''}
      <dl class="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
        <dt class="text-suave">Solicita</dt><dd>${esc(a.solicita.nombre)} <span class="text-xs text-suave">(${esc(a.solicita.rol)})</span></dd>
        <dt class="text-suave">Motivo</dt><dd>${esc(a.motivo)}</dd>
      </dl>
      ${
        puedeAccionar
          ? `<div class="mt-4 flex justify-end gap-2">
               <button type="button" class="btn btn-secundario" data-rechazar="${esc(a.id)}">Rechazar</button>
               <button type="button" class="btn btn-confirmar" data-aprobar="${esc(a.id)}">Aprobar</button>
             </div>`
          : ''
      }
    </article>`;
}

function htmlAutorizaciones(d, puedeAccionar) {
  const pendientes = d.pendientes.length
    ? `<div class="grid gap-3 lg:grid-cols-2">${d.pendientes.map((a) => tarjetaPendiente(a, puedeAccionar)).join('')}</div>`
    : `<div class="tarjeta">${estadoVacio('No hay solicitudes pendientes', 'Cuando un líder pida una corrección o una reapertura, aparecerá aquí.')}</div>`;

  const resueltas = tabla({
    filas: d.resueltas,
    vacio: 'Todavía no hay solicitudes resueltas.',
    columnas: [
      { titulo: 'Resuelta', texto: (a) => cuando(a.fechaResolucion, a.horaResolucion) },
      { titulo: 'Solicitud', html: (a) => `<strong>${esc(a.tipo)}</strong><br><span class="text-xs text-suave">Línea ${esc(a.linea)} · Turno ${esc(a.turno)} · ${esc(cambioTexto(a.cambio))}</span>` },
      { titulo: 'Solicitó', html: (a) => `${esc(a.solicita.nombre)}<br><span class="text-xs text-suave">${esc(a.solicita.rol)}</span>` },
      { titulo: 'Resolvió', html: (a) => `${esc(a.resolvio.nombre)}<br><span class="text-xs text-suave">${esc(a.resolvio.rol)}</span>` },
      { titulo: 'Resultado', html: (a) => chip(a.estado, a.estado === 'Aprobada' ? 'exito' : 'peligro') },
      { titulo: 'Motivo del rechazo', texto: (a) => a.motivoResolucion || '—' },
    ],
  });

  return `
    <h2 class="mb-2 flex items-center gap-2">Pendientes ${chip(String(d.pendientes.length), d.pendientes.length ? 'aviso' : 'neutro')}</h2>
    ${pendientes}
    <div class="mt-5">${tarjeta('Resueltas recientes', resueltas, { relleno: false })}</div>`;
}

function conectarBotones(datos, recargar) {
  const buscar = (id) => datos.pendientes.find((a) => a.id === id);

  document.querySelectorAll('[data-aprobar]').forEach((boton) =>
    boton.addEventListener('click', async () => {
      const a = buscar(boton.dataset.aprobar);
      const respuesta = await preguntar({
        titulo: `Aprobar ${a.tipo.toLowerCase()}`,
        mensaje: `Línea ${a.linea}, turno ${a.turno}${a.cambio ? ` · ${cambioTexto(a.cambio)}` : ''}. Quedará registrado que la aprobaste tú y cuándo.`,
        textoOk: 'Aprobar',
        tipoOk: 'confirmar',
      });
      if (respuesta) await resolver(a.id, 'aprobar', '', 'La solicitud fue aprobada.', boton, recargar);
    }),
  );

  document.querySelectorAll('[data-rechazar]').forEach((boton) =>
    boton.addEventListener('click', async () => {
      const a = buscar(boton.dataset.rechazar);
      const respuesta = await preguntar({
        titulo: `Rechazar ${a.tipo.toLowerCase()}`,
        mensaje: `Línea ${a.linea}, turno ${a.turno}. El líder verá el motivo que escribas.`,
        motivo: { etiqueta: 'Motivo del rechazo', requerido: true },
        textoOk: 'Rechazar',
        tipoOk: 'peligro',
      });
      if (respuesta) await resolver(a.id, 'rechazar', respuesta.motivo, 'La solicitud fue rechazada.', boton, recargar);
    }),
  );
}

async function resolver(id, decision, motivo, mensaje, boton, recargar) {
  boton.disabled = true;
  try {
    await resolverAutorizacion(id, { decision, motivo });
    mostrarAviso(mensaje, decision === 'aprobar' ? 'exito' : 'info');
    recargar();
  } catch (error) {
    mostrarAviso(error.message, 'peligro');
    boton.disabled = false;
  }
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
