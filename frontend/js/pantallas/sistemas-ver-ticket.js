// Pantalla: Sistemas · Ver ticket (se llega desde «Área de tickets», con ?id=T-0001).
// Muestra los datos del ticket y permite cerrarlo con un comentario de lo que se hizo.

import { montarPagina, rutaA } from '../layout.js';
import { ticket, cerrarTicket } from '../api.js';
import { encabezado, tarjeta, chip, campo, marcarError, aviso, cargarEn, mostrarAviso, mostrarAvisoDespues } from '../componentes.js';
import { esc, fechaCorta } from '../ui.js';

const pagina = montarPagina('sistemas/ver-ticket');

const LISTA = () => rutaA('pages/sistemas/area-de-tickets.html');

function iniciar({ sesion, contenido, puedeAccionar }) {
  const id = new URLSearchParams(location.search).get('id') || '';
  contenido.innerHTML = `${encabezado(sesion, 'Ver ticket')}<div id="resultado" class="mt-4"></div>`;
  const zona = document.getElementById('resultado');

  if (!id) {
    zona.innerHTML = `<div class="tarjeta p-6 text-center"><p class="font-semibold">No se indicó qué ticket abrir</p><a class="btn btn-secundario mt-3" href="${LISTA()}">Volver a los tickets</a></div>`;
    return;
  }

  cargarEn(zona, async () => {
    const t = await ticket(id);
    return { html: htmlTicket(t, puedeAccionar), listo: () => conectar(t) };
  });
}

function dato(titulo, valor) {
  return `<div><dt class="text-xs text-suave">${esc(titulo)}</dt><dd class="mt-0.5 font-medium">${valor}</dd></div>`;
}

function htmlTicket(t, puedeAccionar) {
  const abierto = t.estado === 'Abierto';
  const datos = `
    <dl class="grid grid-cols-2 gap-4 md:grid-cols-3">
      ${dato('Ticket', `<span class="tabular-nums">${esc(t.id)}</span>`)}
      ${dato('Estado', chip(t.estado, abierto ? 'aviso' : 'exito'))}
      ${dato('Levantado', esc(`${fechaCorta(t.fecha)} ${t.hora}`))}
      ${dato('N.º de empleado', esc(t.numEmpleado))}
      ${dato('Nombre', esc(t.nombre))}
      ${dato('Motivo', esc(t.motivo))}
    </dl>`;

  // Solo consulta: el ticket abierto se muestra sin formulario de cierre.
  const soloConsulta = abierto && !puedeAccionar
    ? `${aviso('info', 'Tu rol solo puede consultar este ticket. Lo cierra el personal de Sistemas.')}
       <div class="mt-4 flex justify-end"><a class="btn btn-secundario" href="${LISTA()}">Volver</a></div>`
    : '';

  const cierre = soloConsulta ? soloConsulta : abierto
    ? `<form id="form-cierre" novalidate>
         ${campo({ id: 'comentarios', etiqueta: 'Comentarios', tipo: 'textarea', requerido: true, ayuda: 'Escribe qué se hizo, por ejemplo «Se restableció la contraseña».' })}
         <div class="mt-4 flex flex-wrap justify-end gap-2">
           <a class="btn btn-enlace mr-auto self-center" href="${rutaA(`pages/sistemas/nuevo-o-editar-usuario.html?id=${encodeURIComponent(t.numEmpleado)}`)}">Abrir el usuario ${esc(t.numEmpleado)}</a>
           <a class="btn btn-secundario" href="${LISTA()}">Volver</a>
           <button type="submit" id="cerrar" class="btn btn-confirmar">Cerrar ticket</button>
         </div>
       </form>`
    : `${aviso('exito', 'Este ticket ya está cerrado.')}
       <dl class="mt-4"><dt class="text-xs text-suave">Comentarios</dt><dd class="mt-0.5 whitespace-pre-line">${esc(t.comentarios || 'Sin comentarios.')}</dd></dl>
       <div class="mt-4 flex justify-end"><a class="btn btn-secundario" href="${LISTA()}">Volver</a></div>`;

  return `${tarjeta('Datos del ticket', datos)}<div class="mt-4">${tarjeta(abierto ? (puedeAccionar ? 'Cerrar ticket' : 'Cierre pendiente') : 'Cierre', cierre)}</div>`;
}

function conectar(t) {
  const formulario = document.getElementById('form-cierre');
  if (!formulario) return;
  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const comentarios = document.getElementById('comentarios').value.trim();
    marcarError('comentarios', comentarios ? '' : 'Escribe qué se hizo antes de cerrar el ticket.');
    if (!comentarios) return;

    const boton = document.getElementById('cerrar');
    boton.disabled = true;
    boton.textContent = 'Cerrando…';
    try {
      await cerrarTicket(t.id, { comentarios });
      mostrarAvisoDespues(`El ticket ${t.id} quedó cerrado.`);
      location.href = LISTA();
    } catch (error) {
      mostrarAviso(error.message, 'peligro');
      boton.disabled = false;
      boton.textContent = 'Cerrar ticket';
    }
  });
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
