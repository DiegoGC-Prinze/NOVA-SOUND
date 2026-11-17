// Pantalla provisional para las pantallas que todavía no están hechas.
// El menú manda aquí cuando una pantalla tiene `lista: false` en js/menu.js.

import { montarPagina } from '../layout.js';
import { buscarPantalla, AREAS } from '../menu.js';
import { esc } from '../ui.js';

const id = new URLSearchParams(location.search).get('id') || '';
const pantalla = buscarPantalla(id);
const pagina = pantalla && montarPagina(id);

if (!pantalla) {
  document.getElementById('contenido').innerHTML = `<div class="tarjeta mx-auto mt-10 max-w-lg p-6 text-center"><h1>No encontramos esa pantalla</h1></div>`;
} else if (pagina) {
  pagina.contenido.innerHTML = `
    <div class="tarjeta mx-auto mt-10 max-w-lg p-6 text-center">
      <p class="text-xs font-semibold uppercase tracking-wide text-suave">${esc(AREAS[pantalla.area])}</p>
      <h1 class="mt-1">${esc(pantalla.nombre)}</h1>
      <p class="mt-3 text-suave">Esta pantalla todavía no está lista. Cuando se termine, quien la haga cambia <code class="rounded bg-fondo px-1">lista: true</code> en <code class="rounded bg-fondo px-1">js/menu.js</code> y el menú la abrirá aquí.</p>
      <button type="button" class="btn btn-secundario mt-4" onclick="history.back()">Volver</button>
    </div>`;
}
