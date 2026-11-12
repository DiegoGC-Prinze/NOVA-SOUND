// Pantalla: Login (index.html).
// Número de empleado + contraseña. Al entrar guarda la sesión y manda al rol a su primera pantalla.

import { inicioDelRol, rutaA } from '../layout.js';
import { iniciarSesion, usuariosDeEjemplo, reiniciarMocks, ErrorApi } from '../api.js';
import { USE_MOCKS } from '../config.js';
import { guardarSesion, obtenerSesion, cerrarSesion } from '../session.js';
import { campo, marcarError, mostrarAviso } from '../componentes.js';
import { esc } from '../ui.js';


const contenido = document.getElementById('contenido');

contenido.innerHTML = `
    <div class="flex w-full max-w-md flex-col gap-4">
        <img src="${rutaA('img/logo.png')}" alt="Nova Sound" class="mx-auto h-28 w-auto">
    <div id="sesion-activa"></div>

    <form id="form-login" class="tarjeta bg-white/85 p-6 backdrop-blur-sm" novalidate>
      <h1>Iniciar sesión</h1>
      <p class="mt-1 text-suave">Entra con tu número de empleado. Cada persona usa su propia cuenta.</p>

      <div id="error-general" class="aviso aviso-peligro mt-4 hidden" role="alert"></div>

      <div class="mt-4 flex flex-col gap-4">
        ${campo({ id: 'numEmpleado', etiqueta: 'Número de empleado', placeholder: 'Ej. 5002', requerido: true, extra: 'autocomplete="username" inputmode="numeric" autofocus' })}
        <div>
          <label class="etiqueta" for="contrasena">Contraseña <span class="text-peligro" aria-hidden="true">*</span></label>
          <div class="flex gap-2">
            <input id="contrasena" name="contrasena" type="password" class="campo" autocomplete="current-password" required aria-describedby="contrasena-error">
            <button type="button" id="ver-contrasena" class="btn btn-secundario" aria-pressed="false">Ver</button>
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
  botonVer.textContent = oculta ? 'Ocultar' : 'Ver';
  botonVer.setAttribute('aria-pressed', String(oculta));
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
      <details class="tarjeta bg-white/85 text-sm backdrop-blur-sm">
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
