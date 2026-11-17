import { esc } from '../ui.js';

export const CAPACIDAD_POR_MODELO = {
  MINI: 12,
  SPORT: 8,
  PRO: 6,
  MAX: 4,
};

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