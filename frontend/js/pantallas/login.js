// Pantalla: Login (index.html).
// Número de empleado + contraseña. Al entrar guarda la sesión y manda al rol a su primera pantalla.

import { inicioDelRol, rutaA } from '../layout.js';
import { iniciarSesion, usuariosDeEjemplo, reiniciarMocks, ErrorApi } from '../api.js';
import { USE_MOCKS } from '../config.js';
import { guardarSesion, obtenerSesion, cerrarSesion } from '../session.js';
import { campo, marcarError, mostrarAviso } from '../componentes.js';
import { esc } from '../ui.js';

const contenido = document.getElementById('contenido');

// Iconos del botón para mostrar u ocultar la contraseña (ojo / ojo tachado)
const OJO = '<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_TACHADO = '<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

contenido.innerHTML = `
  <div class="flex w-full max-w-md flex-col gap-4">
    <img src="${rutaA('img/logo.png')}" alt="Nova Sound" class="mx-auto h-28 w-auto">
    <div id="sesion-activa"></div>

    <form id="form-login" class="tarjeta bg-white/85 p-6 shadow-xl shadow-black/25 backdrop-blur-sm" novalidate>
      <h1 class="text-center">Iniciar sesión</h1>
      <p class="mt-1 text-center text-suave">Entra con tu número de empleado. Cada persona usa su propia cuenta.</p>

      <div id="error-general" class="aviso aviso-peligro mt-4 hidden" role="alert"></div>

      <div class="mt-4 flex flex-col gap-4">
        ${campo({ id: 'numEmpleado', etiqueta: 'Número de empleado', placeholder: 'Ej. 5002', requerido: true, extra: 'autocomplete="username" inputmode="numeric" autofocus' })}
        <div>
          <label class="etiqueta" for="contrasena">Contraseña <span class="text-peligro" aria-hidden="true">*</span></label>
          <div class="relative">
            <input id="contrasena" name="contrasena" type="password" class="campo pr-11" autocomplete="current-password" required aria-describedby="contrasena-error">
            <button type="button" id="ver-contrasena" aria-pressed="false" aria-label="Mostrar contraseña" title="Mostrar contraseña"
                    class="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-suave transition duration-150 hover:bg-marca-claro hover:text-marca focus-visible:outline-2 focus-visible:outline-marca">${OJO}</button>
          </div>
          <p id="contrasena-error" class="texto-error hidden" role="alert"></p>
        </div>
      </div>

      <button type="submit" id="entrar" class="btn btn-principal mt-5 w-full">Entrar</button>
      <p class="mt-4 text-center text-sm">
        <a class="text-marca underline-offset-2 hover:underline" href="${rutaA('pages/login/levantar-ticket.html')}">¿Olvidó la contraseña?</a>
      </p>
    </form>

    <div id="ejemplos"></div>
  </div>`;

// ---------- Sesión que ya estaba abierta
const previa = obtenerSesion();
if (previa) {
  const inicio = inicioDelRol(previa);
  document.getElementById('sesion-activa').innerHTML = `
    <div class="aviso aviso-info flex flex-wrap items-center justify-between gap-2">
      <span>Ya hay una sesión abierta: <strong>${esc(previa.usuario.nombre)}</strong> (${esc(previa.usuario.rol)}).</span>
      <span class="flex gap-2">
        ${inicio ? `<a class="btn btn-principal h-8 px-3" href="${inicio}">Continuar</a>` : ''}
        <button type="button" id="cerrar-previa" class="btn btn-secundario h-8 px-3">Cerrar sesión</button>
      </span>
    </div>`;
  document.getElementById('cerrar-previa').addEventListener('click', () => {
    cerrarSesion();
    document.getElementById('sesion-activa').innerHTML = '';
  });
}

// ---------- Mostrar u ocultar la contraseña
const botonVer = document.getElementById('ver-contrasena');
botonVer.addEventListener('click', () => {
  const campoContrasena = document.getElementById('contrasena');
  const oculta = campoContrasena.type === 'password';
  campoContrasena.type = oculta ? 'text' : 'password';
  const texto = oculta ? 'Ocultar contraseña' : 'Mostrar contraseña';
  botonVer.innerHTML = oculta ? OJO_TACHADO : OJO;
  botonVer.setAttribute('aria-pressed', String(oculta));
  botonVer.setAttribute('aria-label', texto);
  botonVer.title = texto;
});

// ---------- Enviar
const formulario = document.getElementById('form-login');
const errorGeneral = document.getElementById('error-general');
const botonEntrar = document.getElementById('entrar');

formulario.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorGeneral.classList.add('hidden');
  const numEmpleado = document.getElementById('numEmpleado').value.trim();
  const contrasena = document.getElementById('contrasena').value;

  marcarError('numEmpleado', numEmpleado ? '' : 'Escribe tu número de empleado.');
  marcarError('contrasena', contrasena ? '' : 'Escribe tu contraseña.');
  if (!numEmpleado || !contrasena) return;

  botonEntrar.disabled = true;
  botonEntrar.textContent = 'Entrando…';
  try {
    const sesion = await iniciarSesion(numEmpleado, contrasena);
    guardarSesion(sesion);
    const destino = inicioDelRol(sesion);
    if (!destino) throw new ErrorApi('Tu rol todavía no tiene pantallas asignadas. Avisa al administrador.', 403);
    location.href = destino;
  } catch (error) {
    errorGeneral.textContent = error.message || 'No se pudo iniciar sesión.';
    errorGeneral.classList.remove('hidden');
    botonEntrar.disabled = false;
    botonEntrar.textContent = 'Entrar';
  }
});

// ---------- Solo en modo ejemplo: usuarios para probar
if (USE_MOCKS) {
  usuariosDeEjemplo().then((lista) => {
    document.getElementById('ejemplos').innerHTML = `
      <details class="tarjeta bg-white/85 text-sm shadow-md shadow-black/20 backdrop-blur-sm">
        <summary class="cursor-pointer px-4 py-3 font-semibold text-marca-osc">Usuarios de ejemplo (solo para pruebas)</summary>
        <div class="border-t border-borde px-4 py-3">
          <p class="mb-2 text-xs text-suave">Toca uno para llenar el formulario. La contraseña de todos es <strong>nova123</strong>.</p>
          <ul class="flex flex-col gap-1">
            ${lista
              .map(
                (u) => `<li><button type="button" data-num="${esc(u.numEmpleado)}" class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-marca-claro">
                  <span><strong class="tabular-nums">${esc(u.numEmpleado)}</strong> · ${esc(u.nombre)}</span>
                  <span class="text-xs text-suave">${esc(u.rol)}${u.estado !== 'Activo' ? ' · bloqueado' : ''}</span></button></li>`,
              )
              .join('')}
          </ul>
          <button type="button" id="reiniciar" class="btn btn-enlace mt-3 text-xs">Restablecer los datos de ejemplo</button>
        </div>
      </details>`;
    document.querySelectorAll('[data-num]').forEach((b) =>
      b.addEventListener('click', () => {
        document.getElementById('numEmpleado').value = b.dataset.num;
        document.getElementById('contrasena').value = 'nova123';
        document.getElementById('entrar').focus();
      }),
    );
    document.getElementById('reiniciar').addEventListener('click', () => {
      reiniciarMocks();
      mostrarAviso('Los datos de ejemplo volvieron a su estado original.', 'info');
    });
  });
}