// Pantalla: Levantar ticket. La usa quien no puede entrar (cuenta bloqueada u olvidó la contraseña).
// No requiere sesión.

import { montarCabeceraPublica, rutaA } from '../layout.js';
import { levantarTicket } from '../api.js';
import { campo, marcarError } from '../componentes.js';
import { esc } from '../ui.js';

montarCabeceraPublica();
const contenido = document.getElementById('contenido');
const volver = rutaA('index.html');

function verFormulario() {
  contenido.innerHTML = `
    <div class="mx-auto max-w-md pt-8">
      <form id="form-ticket" class="tarjeta p-6" novalidate>
        <h1>Levantar ticket</h1>
        <p class="mt-1 text-suave">Si no puedes entrar, avisa al área de Sistemas con este formulario.</p>

        <div id="error-general" class="aviso aviso-peligro mt-4 hidden" role="alert"></div>

        <div class="mt-4 flex flex-col gap-4">
          ${campo({ id: 'numEmpleado', etiqueta: 'Número de empleado', requerido: true, extra: 'inputmode="numeric" autofocus' })}
          ${campo({ id: 'nombre', etiqueta: 'Nombre', requerido: true, extra: 'autocomplete="name"' })}
          ${campo({ id: 'motivo', etiqueta: 'Motivo', requerido: true, opciones: ['Cuenta bloqueada', 'Olvidó la contraseña'] })}
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <a class="btn btn-secundario" href="${volver}">Cancelar</a>
          <button type="submit" id="enviar" class="btn btn-principal">Enviar</button>
        </div>
      </form>
    </div>`;

  const formulario = document.getElementById('form-ticket');
  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = {
      numEmpleado: document.getElementById('numEmpleado').value.trim(),
      nombre: document.getElementById('nombre').value.trim(),
      motivo: document.getElementById('motivo').value,
    };
    marcarError('numEmpleado', datos.numEmpleado ? '' : 'Escribe tu número de empleado.');
    marcarError('nombre', datos.nombre ? '' : 'Escribe tu nombre.');
    if (!datos.numEmpleado || !datos.nombre) return;

    const boton = document.getElementById('enviar');
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    try {
      const { id } = await levantarTicket(datos);
      verConfirmacion(id);
    } catch (error) {
      const caja = document.getElementById('error-general');
      caja.textContent = error.message;
      caja.classList.remove('hidden');
      boton.disabled = false;
      boton.textContent = 'Enviar';
    }
  });
}

// Pantalla de confirmación
function verConfirmacion(id) {
  contenido.innerHTML = `
    <div class="mx-auto max-w-md pt-8">
      <div class="tarjeta p-6 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#DDF1DE] text-2xl text-exito" aria-hidden="true">✓</div>
        <h1 class="mt-3">Ticket enviado</h1>
        <p class="mt-2 text-suave">Tu ticket quedó registrado con el folio <strong class="text-texto">${esc(id)}</strong>. Sistemas lo revisará y se pondrá en contacto contigo.</p>
        <a class="btn btn-principal mt-5" href="${volver}">Volver al inicio de sesión</a>
      </div>
    </div>`;
  contenido.querySelector('a').focus();
}

verFormulario();
