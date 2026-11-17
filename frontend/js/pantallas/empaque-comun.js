import { esc } from '../ui.js';
import { aviso, boton } from '../componentes.js';

export const CAPACIDAD_POR_MODELO = {
  MINI: 12,
  SPORT: 8,
  PRO: 6,
  MAX: 4,
};

export const VALIDACIONES_CIERRE = [
  'Unidades liberadas por Calidad',
  'Modelo correcto',
  'Capacidad respetada',
  'Reglas del cliente verificadas',
];

// Devuelve { dialogo, cerrar }. Los eventos se conectan después con dialogo.querySelector(...)
export function abrirVentana({ titulo, html, ancho = '40rem' }) {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'dialogo';
  dialogo.style.width = `min(${ancho}, calc(100vw - 2rem))`;
  dialogo.setAttribute('aria-labelledby', 'ventana-titulo');
  dialogo.innerHTML = `
    <div class="max-h-[88vh] overflow-y-auto p-5">
      <h2 id="ventana-titulo" class="text-base font-bold text-marca-osc">${esc(titulo)}</h2>
      ${html}
    </div>`;
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

// Ventana reutilizable de Resumen y Validaciones para cerrar una caja
export function abrirResumenDeCierre({ idCaja, orden, cliente, modelo, cantidad, capacidad, onConfirmar }) {
  const incompleta = cantidad < capacidad;
  const { dialogo, cerrar } = abrirVentana({
    titulo: 'Resumen de caja',
    html: `
      <dl class="mt-4 grid grid-cols-2 gap-4">
        <div><dt class="text-xs text-suave">Id de caja</dt><dd class="font-semibold">${esc(idCaja)}</dd></div>
        <div><dt class="text-xs text-suave">Orden</dt><dd class="font-semibold">${esc(orden)}</dd></div>
        <div><dt class="text-xs text-suave">Cliente</dt><dd class="font-semibold">${esc(cliente)}</dd></div>
        <div><dt class="text-xs text-suave">Modelo</dt><dd class="font-semibold">${esc(modelo)}</dd></div>
        <div><dt class="text-xs text-suave">Unidades</dt><dd class="font-semibold">${cantidad} de ${capacidad}</dd></div>
      </dl>
      ${incompleta ? `<div class="mt-3">${aviso('aviso', `La caja no está llena: ${cantidad} de ${capacidad} unidades.`)}</div>` : ''}
      <fieldset class="mt-4">
        <legend class="etiqueta">Validaciones</legend>
        <div class="grid gap-2">
          ${VALIDACIONES_CIERRE.map(
            (v, i) => `
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" class="h-4 w-4 accent-marca" data-validacion="${i}">
              ${esc(v)}
            </label>`
          ).join('')}
        </div>
        <p id="validaciones-error" class="texto-error hidden" role="alert"></p>
      </fieldset>
      <p class="mt-4 text-xs text-suave">Al confirmar, la caja queda cerrada y se registran usuario, fecha y hora.</p>
      <div class="mt-5 flex justify-end gap-2">
        ${boton('Volver', { tipo: 'secundario', id: 'volver' })}
        ${boton('Confirmar cierre', { tipo: 'confirmar', id: 'confirmar' })}
      </div>`,
  });

  dialogo.querySelector('#volver').addEventListener('click', cerrar);
  dialogo.querySelector('#confirmar').addEventListener('click', () => {
    const todas = [...dialogo.querySelectorAll('[data-validacion]')].every((c) => c.checked);
    const error = dialogo.querySelector('#validaciones-error');
    error.textContent = todas ? '' : 'Marca todas las validaciones para cerrar la caja.';
    error.classList.toggle('hidden', todas);
    if (!todas) return;

    cerrar();
    onConfirmar();
  });
}