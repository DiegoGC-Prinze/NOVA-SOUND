// Pantalla: Sistemas · Nuevo o editar usuario (?id=1001 para editar; sin id es un usuario nuevo).
// Decisión de equipo (C2): la persona inicia sesión con su NÚMERO DE EMPLEADO, así que ya no hay un campo «usuario» aparte.

import { montarPagina, rutaA } from '../layout.js';
import { usuario, guardarUsuario, rolesPermisos } from '../api.js';
import { encabezado, tarjeta, campo, marcarError, aviso, cargarEn, mostrarAvisoDespues } from '../componentes.js';

const pagina = montarPagina('sistemas/nuevo-o-editar-usuario');

const LISTA = () => rutaA('pages/sistemas/usuarios.html');

function iniciar({ sesion, contenido, puedeAccionar }) {
  const id = new URLSearchParams(location.search).get('id');
  const esNuevo = !id;
  contenido.innerHTML = `${encabezado(sesion, esNuevo ? 'Nuevo usuario' : 'Editar usuario')}${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar esta pantalla. Los datos del usuario no se pueden modificar.')}</div>`}<div id="resultado" class="mt-4"></div>`;
  const zona = document.getElementById('resultado');

  cargarEn(zona, async () => {
    const [datos, { roles }] = await Promise.all([esNuevo ? Promise.resolve({ estado: 'Activo' }) : usuario(id), rolesPermisos()]);
    return { html: htmlFormulario(datos, roles.map((r) => r.nombre), esNuevo, puedeAccionar), listo: () => conectar(esNuevo, puedeAccionar) };
  });
}

function htmlFormulario(u, roles, esNuevo, puedeAccionar) {
  const campos = `
    <div id="error-general" class="aviso aviso-peligro mb-4 hidden" role="alert"></div>
    <fieldset ${puedeAccionar ? '' : 'disabled'} class="min-w-0">
    <div class="grid gap-4 md:grid-cols-2">
      ${campo({ id: 'nombre', etiqueta: 'Nombre completo', valor: u.nombre || '', requerido: true, extra: 'autocomplete="off"' })}
      ${campo({ id: 'numEmpleado', etiqueta: 'Número de empleado', valor: u.numEmpleado || '', requerido: true, ayuda: esNuevo ? 'Con este número inicia sesión.' : 'No se puede cambiar.', extra: `inputmode="numeric" ${esNuevo ? '' : 'readonly'}` })}
      ${campo({ id: 'rol', etiqueta: 'Rol', valor: u.rol || '', requerido: true, opciones: [{ valor: '', texto: 'Elige un rol' }, ...roles] })}
      ${campo({ id: 'estado', etiqueta: 'Estado', valor: u.estado || 'Activo', requerido: true, opciones: ['Activo', 'Bloqueado', 'Inactivo'], ayuda: 'Una cuenta bloqueada o inactiva no puede iniciar sesión.' })}
      ${campo({ id: 'contrasena', etiqueta: esNuevo ? 'Contraseña' : 'Contraseña nueva', tipo: 'password', requerido: esNuevo, ayuda: esNuevo ? 'Mínimo 6 caracteres.' : 'Déjala vacía para conservar la actual.', extra: 'autocomplete="new-password"' })}
    </div>
    </fieldset>
    <div class="mt-6 flex justify-end gap-2">
      <a class="btn btn-secundario" href="${LISTA()}">${puedeAccionar ? 'Cancelar' : 'Volver'}</a>
      ${puedeAccionar ? '<button type="submit" id="guardar" class="btn btn-principal">Guardar</button>' : ''}
    </div>`;
  return `<form id="form-usuario" novalidate class="max-w-3xl">${tarjeta(esNuevo ? 'Datos del usuario nuevo' : `Datos de ${u.nombre}`, campos)}</form>`;
}

function conectar(esNuevo, puedeAccionar) {
  const formulario = document.getElementById('form-usuario');
  if (!puedeAccionar) return; // solo consulta: no hay nada que guardar
  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    const datos = { nombre: v('nombre'), numEmpleado: v('numEmpleado'), rol: v('rol'), estado: v('estado'), contrasena: document.getElementById('contrasena').value };

    // Validación (el back vuelve a validar; esto solo ahorra un viaje).
    const errores = {
      nombre: datos.nombre ? '' : 'Escribe el nombre.',
      numEmpleado: !datos.numEmpleado ? 'Escribe el número de empleado.' : /^\d+$/.test(datos.numEmpleado) ? '' : 'Usa solo números.',
      rol: datos.rol ? '' : 'Elige un rol.',
      contrasena: esNuevo && !datos.contrasena ? 'Escribe una contraseña.' : datos.contrasena && datos.contrasena.length < 6 ? 'Debe tener al menos 6 caracteres.' : '',
    };
    Object.entries(errores).forEach(([id, mensaje]) => marcarError(id, mensaje));
    if (Object.values(errores).some(Boolean)) {
      document.querySelector('.campo-error')?.focus();
      return;
    }

    const boton = document.getElementById('guardar');
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await guardarUsuario(datos, esNuevo);
      mostrarAvisoDespues(esNuevo ? 'El usuario se creó correctamente.' : 'Los cambios del usuario se guardaron.');
      location.href = LISTA();
    } catch (error) {
      const caja = document.getElementById('error-general');
      caja.textContent = error.message;
      caja.classList.remove('hidden');
      boton.disabled = false;
      boton.textContent = 'Guardar';
    }
  });
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
