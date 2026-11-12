// Marco común de todas las pantallas (menos el login): barra superior (hora, usuario, Salir),
// menú lateral izquierdo con las pantallas del rol (se puede ocultar) y control de sesión y permisos.
//
// Cada pantalla hace esto al empezar:
//
//   import { montarPagina } from '../layout.js';
//   const pagina = montarPagina('gerencia/dashboard');   // el id está en js/menu.js
//   if (!pagina) throw new Error('detenido');             // sin sesión o sin permiso: ya se mostró el aviso
//   const { sesion, contenido, puedeAccionar } = pagina;
//
// Lo que devuelve:
//   sesion        -> { token, usuario: { numEmpleado, nombre, rol }, permisos, acciones }
//   contenido     -> el <main> donde se pinta la pantalla
//   puedeAccionar -> true si el rol tiene «Acciona» en esta pantalla (false = solo consulta)
//   puede(accion) -> true si el rol tiene ese permiso de acción (ids en mock/roles-permisos.json)
//
// El menú lateral se arma solo con js/menu.js y los permisos que el back devolvió en el login.

import './tema.js';
import { obtenerSesion, cerrarSesion } from './session.js';
import { AREAS, PANTALLAS, buscarPantalla } from './menu.js';
import { esc, fechaLarga, hoyISO, horaActual, turnoPorHora } from './ui.js';
import { mostrarAvisoPendiente } from './componentes.js';

const RAIZ = new URL('../', import.meta.url);

// Dirección completa de un archivo del front: rutaA('index.html').
export const rutaA = (ruta) => new URL(ruta, RAIZ).href;

export const nivelDe = (sesion, id) => sesion?.permisos?.[id] || null;

// Pantallas que el rol puede ver (sin las de login).
export function pantallasVisibles(sesion) {
  return PANTALLAS.filter((p) => p.area !== 'login' && nivelDe(sesion, p.id));
}

// Si la pantalla ya está hecha va a su archivo; si no, a la pantalla «pendiente».
export function urlPantalla(pantalla) {
  return rutaA(pantalla.lista ? pantalla.ruta : `pages/pendiente.html?id=${encodeURIComponent(pantalla.id)}`);
}

// A dónde llega cada rol después de iniciar sesión: a la primera pantalla que puede ver.
export function inicioDelRol(sesion) {
  const primera = pantallasVisibles(sesion).find((p) => p.enMenu);
  return primera ? urlPantalla(primera) : null;
}

// ---------------------------------------------------------------- Barra superior
// Solo lo general: botón del menú, logo, hora y turno, quién entró y Salir.
function htmlBarra(sesion) {
  return `
    <div class="bg-marca text-white shadow-md">
      <div class="flex h-14 items-center gap-3 px-4">
        <button type="button" id="alternar-menu" aria-controls="menu-lateral" aria-expanded="true" aria-label="Mostrar u ocultar el menú"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <img src="${rutaA('img/logo.png')}" alt="Nova Sound" class="h-11 w-auto">
        <div class="ml-auto flex items-center gap-4 text-xs text-white/90">
          <span id="reloj" class="hidden whitespace-nowrap md:inline"></span>
          <span class="hidden text-right leading-tight sm:block"><span class="block font-semibold text-white">${esc(sesion.usuario.nombre)}</span>${esc(sesion.usuario.rol)}</span>
          <button type="button" id="salir" class="rounded-md border border-white/50 px-3 py-1.5 font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Salir</button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- Menú lateral
// Tarjeta flotante a la izquierda (separada de la barra de arriba). Muestra el área y sus pantallas.
// Si el rol tiene más de un área, el nombre del área se despliega para cambiar de área.
function htmlMenu(sesion, pantalla) {
  const visibles = pantallasVisibles(sesion);
  const areas = Object.keys(AREAS).filter((a) => visibles.some((p) => p.area === a && p.enMenu));
  const delArea = visibles.filter((p) => p.area === pantalla.area && p.enMenu);
  const activa = pantalla.padre || pantalla.id;
  const nombreArea = esc(AREAS[pantalla.area]);

  const selector =
    areas.length > 1
      ? `<details id="selector-area">
           <summary class="flex cursor-pointer list-none items-center justify-between rounded-md px-2.5 py-1.5 text-lg font-bold text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden">
             ${nombreArea}<span aria-hidden="true" class="text-xs">▾</span>
           </summary>
           <ul class="mt-1 flex flex-col gap-0.5 border-t border-white/15 pt-1">
             ${areas
               .map((a) => {
                 const primera = visibles.find((p) => p.area === a && p.enMenu);
                 return `<li><a class="block rounded-md px-2.5 py-1.5 text-sm hover:bg-white/10 ${a === pantalla.area ? 'font-bold text-white' : 'text-white/75'}" href="${urlPantalla(primera)}">${esc(AREAS[a])}</a></li>`;
               })
               .join('')}
           </ul>
         </details>`
      : `<p class="px-2.5 py-1.5 text-lg font-bold text-white">${nombreArea}</p>`;

  const enlaces = delArea
    .map((p) => {
      const esActiva = p.id === activa;
      const clases = esActiva
        ? 'bg-white/15 font-semibold text-white shadow-[inset_3px_0_0_var(--color-aviso)]'
        : 'text-white/85 hover:bg-white/10 hover:text-white';
      return `<li><a href="${urlPantalla(p)}" ${esActiva ? 'aria-current="page"' : ''} ${p.lista ? '' : 'title="Esta pantalla aún no está lista"'}
                 class="block rounded-md px-3 py-2 text-sm ${clases} ${p.lista || esActiva ? '' : 'opacity-60'}">${esc(p.nombre)}</a></li>`;
    })
    .join('');

  return `
    <nav id="menu-lateral" aria-label="Pantallas de ${nombreArea}"
         class="sticky top-[4.5rem] z-20 hidden h-[calc(100vh-5.5rem)] w-56 shrink-0 self-start overflow-hidden rounded-xl bg-marca-osc p-3 text-white shadow-md">
      <svg aria-hidden="true" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="2"
           class="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 text-white/10"><circle cx="100" cy="100" r="28"/><circle cx="100" cy="100" r="52"/><circle cx="100" cy="100" r="76"/><circle cx="100" cy="100" r="100"/></svg>
      <div class="relative flex h-full flex-col">
        <div class="border-b border-white/15 pb-2">
          <p class="px-2.5 pt-1 text-[0.68rem] font-semibold uppercase tracking-wider text-white/55">Área</p>
          ${selector}
        </div>
        <ul class="mt-2 flex flex-col gap-0.5 overflow-y-auto">${enlaces}</ul>
        <button type="button" id="cerrar-menu" class="mt-auto flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
          Ocultar menú
        </button>
      </div>
    </nav>`;
}

// El menú empieza abierto en pantallas anchas y cerrado en tablets chicas; si la persona lo
// abrió o cerró, se respeta su elección (se recuerda en el navegador).
const CLAVE_MENU = 'novasound.menu';
function menuAbiertoAlInicio() {
  try {
    const guardado = localStorage.getItem(CLAVE_MENU);
    if (guardado === 'abierto') return true;
    if (guardado === 'cerrado') return false;
  } catch (e) {
    /* sin almacenamiento: se usa el ancho de la pantalla */
  }
  return window.innerWidth >= 1280;
}
function recordarMenu(abierto) {
  try {
    localStorage.setItem(CLAVE_MENU, abierto ? 'abierto' : 'cerrado');
  } catch (e) {
    /* no pasa nada si no se puede guardar */
  }
}

// Pone el menú a la izquierda del <main> sin que las pantallas tengan que saberlo.
function armarMarco(contenido, sesion, pantalla) {
  const marco = document.createElement('div');
  marco.className = 'flex min-h-[calc(100vh-3.5rem)] items-start gap-4 p-4';
  contenido.before(marco);
  marco.insertAdjacentHTML('beforeend', htmlMenu(sesion, pantalla));
  marco.append(contenido);
  contenido.className = 'mx-auto min-w-0 max-w-[1400px] flex-1 pb-8';
}

function actualizarReloj() {
  const el = document.getElementById('reloj');
  if (!el) return;
  const t = turnoPorHora();
  el.textContent = `${fechaLarga(hoyISO())} · ${horaActual()} · ${t ? `Turno ${t}` : 'Fuera de turno'}`;
}

function activarBarra(barra) {
  barra.querySelector('#salir').addEventListener('click', () => {
    cerrarSesion();
    location.href = rutaA('index.html');
  });

  const menu = document.getElementById('menu-lateral');
  const boton = barra.querySelector('#alternar-menu');
  const mostrar = (abierto) => {
    menu.classList.toggle('hidden', !abierto);
    boton.setAttribute('aria-expanded', String(abierto));
  };
  mostrar(menuAbiertoAlInicio());
  boton.addEventListener('click', () => {
    const abrir = menu.classList.contains('hidden');
    mostrar(abrir);
    recordarMenu(abrir);
  });
  document.getElementById('cerrar-menu').addEventListener('click', () => {
    mostrar(false);
    recordarMenu(false);
    boton.focus();
  });

  actualizarReloj();
  setInterval(actualizarReloj, 15000);
}

// ---------------------------------------------------------------- Entrada de cada pantalla
export function montarPagina(id) {
  const sesion = obtenerSesion();
  if (!sesion) {
    location.replace(rutaA('index.html'));
    return null;
  }
  const pantalla = buscarPantalla(id);
  if (!pantalla) throw new Error(`La pantalla «${id}» no está en js/menu.js`);

  document.title = `${pantalla.nombre} · Nova Sound`;
  mostrarAvisoPendiente();
  const barra = document.getElementById('barra-superior');
  barra.innerHTML = htmlBarra(sesion);
  const contenido = document.getElementById('contenido');
  armarMarco(contenido, sesion, pantalla);
  activarBarra(barra);

  const nivel = nivelDe(sesion, id);
  if (!nivel) {
    const inicio = inicioDelRol(sesion);
    contenido.innerHTML = `
      <div class="tarjeta mx-auto mt-10 max-w-lg p-6 text-center">
        <h1>No tienes permiso para ver esta pantalla</h1>
        <p class="mt-2 text-suave">Tu rol (${esc(sesion.usuario.rol)}) no incluye «${esc(pantalla.nombre)}». Si crees que es un error, pídele al administrador que revise tus permisos.</p>
        ${inicio ? `<a class="btn btn-principal mt-4" href="${inicio}">Ir a mi inicio</a>` : ''}
      </div>`;
    return null;
  }
  return {
    sesion,
    contenido,
    pantalla,
    puedeAccionar: nivel === 'acciona',
    puede: (accion) => (sesion.acciones || []).includes(accion),
  };
}

// Cabecera de las pantallas SIN sesión (login y levantar ticket): marca y hora, día y turno.
export function montarCabeceraPublica() {
  document.getElementById('barra-superior').innerHTML = `
    <div class="bg-marca text-white shadow-md">
      <div class="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
        <img src="${rutaA('img/logo.png')}" alt="Nova Sound" class="h-11 w-auto">
        <span id="reloj" class="text-xs text-white/90"></span>
      </div>
    </div>`;
  actualizarReloj();
  setInterval(actualizarReloj, 15000);
}