// Piezas de pantalla que se repiten en todo el sistema. Cada función devuelve HTML (texto).
// Todo dato que venga del back pasa por esc() antes de entrar al HTML.
//
// Ejemplo:
//   contenido.innerHTML = indicador({ titulo: 'Producción', valor: num(1240), tono: 'exito' });

import { esc, num } from './ui.js';

// ---------------------------------------------------------------- Botones y etiquetas
// tipo: 'principal' | 'confirmar' | 'validar' | 'peligro' | 'secundario' | 'enlace'
export function boton(texto, { tipo = 'principal', id = '', enviar = false, extra = '' } = {}) {
  return `<button type="${enviar ? 'submit' : 'button'}"${id ? ` id="${esc(id)}"` : ''} class="btn btn-${tipo}" ${extra}>${esc(texto)}</button>`;
}

// variante: 'exito' | 'aviso' | 'peligro' | 'neutro' | 'info'
export function chip(texto, variante = 'neutro') {
  return `<span class="chip chip-${variante}">${esc(texto)}</span>`;
}

// Estados de la unidad (los mismos que usa el back).
export const ESTADOS_UNIDAD = {
  PROBADA: ['Probada', 'probada'],
  LIBERADA: ['Liberada', 'liberada'],
  EN_RETENCION: ['En retención', 'retencion'],
  RETRABAJO: ['Retrabajo', 'retrabajo'],
  SCRAP: ['Scrap', 'scrap'],
  EMPACADA: ['Empacada', 'empacada'],
  EMBARCADA: ['Embarcada', 'embarcada'],
};

export function chipUnidad(estado) {
  const [texto, clase] = ESTADOS_UNIDAD[estado] || [estado, 'neutro'];
  return `<span class="chip chip-${clase}">${esc(texto)}</span>`;
}

// ---------------------------------------------------------------- Zonas de la pantalla
// Encabezado: título, rol de quien lo ve y (opcional) el botón principal.
export function encabezado(sesion, titulo, acciones = '') {
  return `
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1>${esc(titulo)}</h1>
      <span class="chip chip-info">Rol: ${esc(sesion.usuario.rol)}</span>
      <div class="ml-auto flex flex-wrap gap-2">${acciones}</div>
    </div>`;
}

// Tarjeta con título (y acciones opcionales a la derecha).
export function tarjeta(titulo, cuerpo, { acciones = '', relleno = true } = {}) {
  return `
    <section class="tarjeta">
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-borde px-4 py-3">
        <h2>${esc(titulo)}</h2>
        <div class="flex gap-2">${acciones}</div>
      </header>
      <div class="${relleno ? 'p-4' : ''}">${cuerpo}</div>
    </section>`;
}

// Indicador (número grande con título). tono: 'marca' | 'exito' | 'aviso' | 'retrabajo' | 'peligro' | 'neutro'
const BORDES = {
  marca: 'border-l-marca',
  exito: 'border-l-exito',
  aviso: 'border-l-aviso',
  retrabajo: 'border-l-[#E08A2E]',
  peligro: 'border-l-peligro',
  neutro: 'border-l-[#9AA6B2]',
};
export function indicador({ titulo, valor, nota = '', tono = 'marca' }) {
  return `
    <div class="tarjeta border-l-4 ${BORDES[tono] || BORDES.marca} px-4 py-3">
      <p class="text-xs text-suave">${esc(titulo)}</p>
      <p class="mt-0.5 text-2xl font-bold tabular-nums">${esc(valor)}</p>
      ${nota ? `<p class="mt-0.5 text-xs text-suave">${esc(nota)}</p>` : ''}
    </div>`;
}

// Barra de progreso. tono: 'marca' | 'exito' | 'aviso' | 'retrabajo' | 'peligro' | 'neutro'
const RELLENOS = { marca: 'bg-marca', exito: 'bg-exito', aviso: 'bg-aviso', retrabajo: 'bg-[#E08A2E]', peligro: 'bg-peligro', neutro: 'bg-[#9AA6B2]' };
export function barra(porcentaje, tono = 'marca') {
  const w = Math.max(0, Math.min(100, Number(porcentaje) || 0));
  return `<div class="h-2 w-full rounded-full bg-[#E6EBEF]" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(w)}"><div class="h-2 rounded-full ${RELLENOS[tono] || RELLENOS.marca}" style="width:${w}%"></div></div>`;
}

export function aviso(tipo, texto) {
  return `<div class="aviso aviso-${tipo}" role="${tipo === 'peligro' ? 'alert' : 'status'}">${esc(texto)}</div>`;
}

// ---------------------------------------------------------------- Formularios y filtros
// opciones: ['L1', 'L2'] o [{ valor: 1, texto: 'Turno 1' }]. Si hay opciones es un <select>.
// tipo: 'text' | 'password' | 'number' | 'date' | 'textarea' | …
export function campo({ id, etiqueta, tipo = 'text', valor = '', opciones = null, placeholder = '', requerido = false, ayuda = '', extra = '', clase = '' }) {
  const rotulo = `<label class="etiqueta" for="${esc(id)}">${esc(etiqueta)}${requerido ? ' <span class="text-peligro" aria-hidden="true">*</span>' : ''}</label>`;
  const describe = `aria-describedby="${esc(id)}-error${ayuda ? ` ${esc(id)}-ayuda` : ''}"`;
  let control;
  if (opciones) {
    const lista = opciones.map((o) => (typeof o === 'object' ? o : { valor: o, texto: o }));
    control = `<select id="${esc(id)}" name="${esc(id)}" class="campo" ${requerido ? 'required' : ''} ${describe} ${extra}>${lista
      .map((o) => `<option value="${esc(o.valor)}"${String(o.valor) === String(valor) ? ' selected' : ''}>${esc(o.texto)}</option>`)
      .join('')}</select>`;
  } else if (tipo === 'textarea') {
    control = `<textarea id="${esc(id)}" name="${esc(id)}" rows="3" class="campo" placeholder="${esc(placeholder)}" ${requerido ? 'required' : ''} ${describe} ${extra}>${esc(valor)}</textarea>`;
  } else {
    control = `<input id="${esc(id)}" name="${esc(id)}" type="${tipo}" class="campo" value="${esc(valor)}" placeholder="${esc(placeholder)}" ${requerido ? 'required' : ''} ${describe} ${extra}>`;
  }
  return `<div class="${clase}">${rotulo}${control}${ayuda ? `<p id="${esc(id)}-ayuda" class="mt-1 text-xs text-suave">${esc(ayuda)}</p>` : ''}<p id="${esc(id)}-error" class="texto-error hidden" role="alert"></p></div>`;
}

// Muestra (o quita, con mensaje vacío) el error de un campo hecho con campo().
export function marcarError(id, mensaje = '') {
  const control = document.getElementById(id);
  const error = document.getElementById(`${id}-error`);
  if (!control || !error) return;
  control.classList.toggle('campo-error', Boolean(mensaje));
  control.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  error.textContent = mensaje;
  error.classList.toggle('hidden', !mensaje);
}

// ---------------------------------------------------------------- Tablas
// columnas: [{ titulo, campo | texto: (fila) => 'texto', html: (fila) => '<b>html ya escapado</b>', num: true }]
//   campo / texto -> se escapan solos.   html -> TÚ escapas con esc() lo que venga del back.
export function tabla({ columnas, filas, vacio = 'No hay datos para mostrar.', detalleVacio = '', clase = '' }) {
  if (!filas.length) return estadoVacio(vacio, detalleVacio);
  const cabecera = columnas.map((c) => `<th scope="col"${c.num ? ' class="num"' : ''}>${esc(c.titulo)}</th>`).join('');
  const cuerpo = filas
    .map((f, i) => {
      const celdas = columnas
        .map((c) => {
          const contenido = c.html ? c.html(f, i) : esc(c.texto ? c.texto(f, i) : f[c.campo]);
          return `<td class="${c.num ? 'num' : ''} ${c.clase || ''}">${contenido}</td>`;
        })
        .join('');
      return `<tr>${celdas}</tr>`;
    })
    .join('');
  return `<div class="overflow-x-auto"><table class="tabla ${clase}"><thead><tr>${cabecera}</tr></thead><tbody>${cuerpo}</tbody></table></div>`;
}

// ---------------------------------------------------------------- Estados: cargando, sin datos, error
export function estadoCargando(texto = 'Cargando…') {
  return `
    <div class="px-6 py-10" role="status" aria-live="polite">
      <div class="mx-auto flex max-w-sm flex-col gap-2.5" aria-hidden="true">
        <div class="h-3 animate-pulse rounded bg-[#E6EBEF]"></div>
        <div class="h-3 w-5/6 animate-pulse rounded bg-[#E6EBEF]"></div>
        <div class="h-3 w-4/6 animate-pulse rounded bg-[#E6EBEF]"></div>
      </div>
      <p class="mt-4 text-center text-sm text-suave">${esc(texto)}</p>
    </div>`;
}

export function estadoVacio(titulo, detalle = '') {
  return `
    <div class="px-6 py-10 text-center">
      <p class="font-semibold">${esc(titulo)}</p>
      ${detalle ? `<p class="mt-1 text-sm text-suave">${esc(detalle)}</p>` : ''}
    </div>`;
}

export function estadoError(mensaje) {
  return `
    <div class="px-6 py-8">
      <div class="aviso aviso-peligro mx-auto max-w-xl" role="alert">
        <p class="font-semibold">No se pudo cargar la información</p>
        <p class="mt-0.5">${esc(mensaje)}</p>
        <button type="button" class="btn btn-secundario mt-3" data-reintentar>Reintentar</button>
      </div>
    </div>`;
}

// Carga datos dentro de un contenedor mostrando «cargando» y, si algo falla, el error con «Reintentar».
// La función recibe nada y devuelve el HTML que se pondrá en el contenedor
// (o { html, listo } si después hay que conectar botones: `listo` se ejecuta al terminar de pintar).
// Si el usuario cambia un filtro mientras se carga, solo se pinta la respuesta más reciente.
export async function cargarEn(contenedor, obtenerHtml, textoCargando = 'Cargando…') {
  const mia = (contenedor._carga = (contenedor._carga || 0) + 1);
  contenedor.setAttribute('aria-busy', 'true');
  contenedor.innerHTML = estadoCargando(textoCargando);
  try {
    const resultado = await obtenerHtml();
    if (mia !== contenedor._carga) return;
    const html = typeof resultado === 'string' ? resultado : resultado.html;
    contenedor.innerHTML = html;
    if (typeof resultado === 'object' && resultado.listo) resultado.listo();
  } catch (e) {
    if (mia !== contenedor._carga) return;
    contenedor.innerHTML = estadoError(e.message || 'Ocurrió un error inesperado.');
    contenedor.querySelector('[data-reintentar]')?.addEventListener('click', () => cargarEn(contenedor, obtenerHtml, textoCargando));
  } finally {
    if (mia === contenedor._carga) contenedor.removeAttribute('aria-busy');
  }
}

// ---------------------------------------------------------------- Avisos y confirmaciones
// Aviso breve en la esquina. tipo: 'exito' | 'info' | 'aviso' | 'peligro'
export function mostrarAviso(texto, tipo = 'exito') {
  let zona = document.getElementById('zona-avisos');
  if (!zona) {
    zona = document.createElement('div');
    zona.id = 'zona-avisos';
    zona.className = 'fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2';
    zona.setAttribute('aria-live', 'polite');
    document.body.appendChild(zona);
  }
  const aviso = document.createElement('div');
  aviso.className = `aviso aviso-${tipo} shadow-lg`;
  aviso.textContent = texto;
  zona.appendChild(aviso);
  setTimeout(() => aviso.remove(), 4500);
}

// Igual que mostrarAviso, pero para cuando vas a CAMBIAR de pantalla justo después de guardar:
// el aviso se muestra en la pantalla siguiente (layout.js lo recoge solo).
export function mostrarAvisoDespues(texto, tipo = 'exito') {
  try {
    sessionStorage.setItem('novasound.aviso', JSON.stringify({ texto, tipo }));
  } catch (e) {
    /* sin almacenamiento: no se muestra */
  }
}

export function mostrarAvisoPendiente() {
  try {
    const guardado = sessionStorage.getItem('novasound.aviso');
    if (!guardado) return;
    sessionStorage.removeItem('novasound.aviso');
    const { texto, tipo } = JSON.parse(guardado);
    mostrarAviso(texto, tipo);
  } catch (e) {
    /* nada que mostrar */
  }
}

// Cuadro de confirmación. Devuelve una promesa: null si cancelan, o { motivo } si aceptan.
//   motivo: { etiqueta: 'Motivo', requerido: true }  -> agrega una caja de texto
export function preguntar({ titulo, mensaje = '', motivo = null, textoOk = 'Aceptar', tipoOk = 'principal' }) {
  return new Promise((resolver) => {
    const dialogo = document.createElement('dialog');
    dialogo.className = 'dialogo';
    dialogo.setAttribute('aria-labelledby', 'dialogo-titulo');
    dialogo.innerHTML = `
      <form class="p-5" novalidate>
        <h2 id="dialogo-titulo" class="text-base font-bold">${esc(titulo)}</h2>
        ${mensaje ? `<p class="mt-2 text-sm text-suave">${esc(mensaje)}</p>` : ''}
        ${
          motivo
            ? `<div class="mt-3">
                 <label class="etiqueta" for="dialogo-motivo">${esc(motivo.etiqueta)}${motivo.requerido ? ' <span class="text-peligro">*</span>' : ''}</label>
                 <textarea id="dialogo-motivo" rows="3" class="campo"></textarea>
                 <p id="dialogo-error" class="texto-error hidden" role="alert"></p>
               </div>`
            : ''
        }
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-${tipoOk}">${esc(textoOk)}</button>
        </div>
      </form>`;
    document.body.appendChild(dialogo);

    const cerrar = (valor) => {
      dialogo.close();
      dialogo.remove();
      resolver(valor);
    };
    dialogo.addEventListener('cancel', (e) => {
      e.preventDefault();
      cerrar(null);
    });
    dialogo.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));
    dialogo.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const texto = dialogo.querySelector('#dialogo-motivo')?.value.trim() || '';
      if (motivo?.requerido && !texto) {
        const error = dialogo.querySelector('#dialogo-error');
        error.textContent = 'Escribe el motivo para continuar.';
        error.classList.remove('hidden');
        dialogo.querySelector('#dialogo-motivo').focus();
        return;
      }
      cerrar({ motivo: texto });
    });
    dialogo.showModal();
    (dialogo.querySelector('textarea') || dialogo.querySelector('button[type="submit"]')).focus();
  });
}

// Pequeño atajo que usan varias pantallas para un número con «de»: «268 de 320».
export const nDe = (a, b) => `${num(a)} de ${num(b)}`;
