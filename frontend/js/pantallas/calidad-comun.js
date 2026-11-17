// Piezas que comparten las pantallas de Calidad (resumen, inspección, retenciones, retrabajos, reportes).
// No es una pantalla: solo lo que se repite, para no copiarlo seis veces.

import { esc } from '../ui.js';

// Acción del rol que permite liberar, retener, mandar a retrabajo o a scrap (está en mock/roles-permisos.json).
export const ACCION_DISPOSICION = 'dar-disposicion-de-calidad-liberar-retener-retrabajo-scrap';

export const ETIQUETA_DISPOSICION = {
  LIBERADA: 'Liberada',
  EN_RETENCION: 'En retención',
  RETRABAJO: 'Retrabajo',
  SCRAP: 'Scrap',
};

// Para registrar o cambiar una disposición hacen falta las dos cosas: «Acciona» en la pantalla y la acción del rol.
// Si falta alguna, la pantalla se queda en solo consulta.
export const puedeDisponer = (pagina) => pagina.puedeAccionar && pagina.puede(ACCION_DISPOSICION);

export const AVISO_SOLO_CONSULTA = 'Tu rol solo puede consultar esta pantalla. Dar disposición a las unidades lo hace el Inspector de Calidad.';

// Un dato del tipo «título pequeño + valor». El valor llega ya escapado (usa esc() antes).
export function dato(titulo, valor) {
  return `<div><dt class="text-xs text-suave">${esc(titulo)}</dt><dd class="mt-0.5 font-medium">${valor || '—'}</dd></div>`;
}

// Defectos que se pueden elegir, por categoría, tal como están en Sistemas → Catálogos (solo los activos).
// El código del defecto empieza con el de su categoría: APA-01 es de la categoría APA (Apariencia).
// → { Funcional: ['No enciende', …], Apariencia: [...], … }
export function defectosPorCategoria(catalogos) {
  const defectos = catalogos.defectos.items.filter((d) => d.estado === 'Activo');
  return Object.fromEntries(
    catalogos.categorias.items
      .filter((c) => c.estado === 'Activo')
      .map((c) => [c.nombre, defectos.filter((d) => d.codigo.startsWith(`${c.codigo}-`)).map((d) => d.nombre)]),
  );
}

// Cuadro de diálogo ancho para ver y resolver el detalle de una unidad.
// Devuelve { dialogo, cerrar }: el contenido (html) se conecta después con dialogo.querySelector(...).
export function abrirDetalle({ titulo, html, ancho = '46rem' }) {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'dialogo';
  dialogo.style.width = `min(${ancho}, calc(100vw - 2rem))`;
  dialogo.setAttribute('aria-labelledby', 'detalle-titulo');
  dialogo.innerHTML = `<div class="max-h-[88vh] overflow-y-auto p-5"><h2 id="detalle-titulo" class="text-base font-bold">${esc(titulo)}</h2>${html}</div>`;
  document.body.appendChild(dialogo);
  const cerrar = () => {
    dialogo.close();
    dialogo.remove();
  };
  dialogo.addEventListener('cancel', (e) => {
    e.preventDefault();
    cerrar();
  });
  dialogo.showModal();
  return { dialogo, cerrar };
}

// Opciones de radio con una frase de ayuda. opciones: [{ valor, titulo, ayuda }]
export function radios(nombre, opciones, { seleccionada = '', bloqueado = false } = {}) {
  return `<div class="grid gap-2 sm:grid-cols-2" role="radiogroup">
    ${opciones
      .map(
        (o) => `<label class="flex cursor-pointer items-start gap-2 rounded-md border border-borde bg-white px-3 py-2 ${bloqueado ? 'cursor-not-allowed opacity-60' : ''}">
          <input type="radio" class="mt-0.5 h-4 w-4 accent-marca" name="${esc(nombre)}" value="${esc(o.valor)}" ${o.valor === seleccionada ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
          <span><span class="block text-sm font-semibold">${esc(o.titulo)}</span>${o.ayuda ? `<span class="block text-xs text-suave">${esc(o.ayuda)}</span>` : ''}</span>
        </label>`,
      )
      .join('')}
  </div>`;
}
