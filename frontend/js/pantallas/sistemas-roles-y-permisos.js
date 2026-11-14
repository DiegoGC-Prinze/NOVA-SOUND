// Pantalla: Sistemas · Roles y permisos.
// Se elige un rol y se decide, por pantalla, si NO la ve, solo la CONSULTA («Ver») o puede ACTUAR («Acciona»),
// y qué acciones especiales puede hacer (cerrar caja, reabrir caja, aprobar ajustes…).
// Los cambios se aplican la próxima vez que esa persona inicie sesión.

import { montarPagina } from '../layout.js';
import { rolesPermisos, guardarRol } from '../api.js';
import { AREAS } from '../menu.js';
import { encabezado, tarjeta, aviso, boton, cargarEn, mostrarAviso, preguntar } from '../componentes.js';
import { esc } from '../ui.js';

const pagina = montarPagina('sistemas/roles-y-permisos');

const NIVELES = [
  ['', 'Sin acceso'],
  ['ver', 'Ver'],
  ['acciona', 'Acciona'],
];

function iniciar({ sesion, contenido, puedeAccionar }) {
  contenido.innerHTML = `${encabezado(sesion, 'Roles y permisos')}<div id="resultado" class="mt-4"></div>`;
  const zona = document.getElementById('resultado');

  cargarEn(zona, async () => {
    const datos = await rolesPermisos();
    return { html: '<div id="editor"></div>', listo: () => editor(datos, sesion, puedeAccionar) };
  });
}

function editor(datos, sesion, puedeAccionar) {
  const zona = document.getElementById('editor');
  let rolActual = datos.roles.find((r) => r.nombre === sesion.usuario.rol)?.nombre || datos.roles[0].nombre;
  let edicion = copiar(rolActual);
  let original = JSON.stringify(edicion);

  function copiar(nombre) {
    const r = datos.roles.find((x) => x.nombre === nombre);
    return { permisos: { ...r.permisos }, acciones: [...r.acciones] };
  }
  const hayCambios = () => JSON.stringify(edicion) !== original;

  function pintar() {
    const rol = datos.roles.find((r) => r.nombre === rolActual);
    const esAdmin = rol.nombre === 'Administrador';
    const areas = Object.keys(AREAS).filter((a) => a !== 'login');

    const tarjetasAreas = areas
      .map((area) => {
        const pantallas = datos.pantallas.filter((p) => p.area === area);
        if (!pantallas.length) return '';
        const filas = pantallas
          .map((p, i) => {
            const actual = edicion.permisos[p.id] || '';
            const bloqueado = !puedeAccionar || (esAdmin && area === 'sistemas'); // sin «Acciona» no se edita; y el administrador no puede quitarse Sistemas
            const radios = NIVELES.map(
              ([valor, texto]) => `
              <label class="flex cursor-pointer items-center gap-1.5 ${bloqueado ? 'cursor-not-allowed opacity-60' : ''}">
                <input type="radio" class="h-4 w-4 accent-marca" name="perm-${esc(p.id)}" value="${valor}" data-pantalla="${esc(p.id)}" ${actual === valor ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
                <span>${texto}</span>
              </label>`,
            ).join('');
            return `<tr><td class="font-medium">${esc(p.nombre)}</td><td><fieldset class="flex flex-wrap gap-x-4 gap-y-1"><legend class="sr-only">Acceso a ${esc(p.nombre)}</legend>${radios}</fieldset></td></tr>`;
          })
          .join('');
        return tarjeta(AREAS[area], `<table class="tabla"><thead><tr><th scope="col">Pantalla</th><th scope="col">Acceso</th></tr></thead><tbody>${filas}</tbody></table>`, { relleno: false });
      })
      .join('');

    const acciones = datos.acciones
      .map(
        (a) => `<label class="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-fondo">
          <input type="checkbox" class="mt-0.5 h-4 w-4 accent-marca" data-accion="${esc(a.id)}" ${edicion.acciones.includes(a.id) ? 'checked' : ''} ${puedeAccionar ? '' : 'disabled'}>
          <span>${esc(a.nombre)}</span></label>`,
      )
      .join('');

    zona.innerHTML = `
      <div class="tarjeta flex flex-wrap items-end gap-4 p-3">
        <div class="w-72">
          <label class="etiqueta" for="rol">Rol</label>
          <select id="rol" class="campo">${datos.roles.map((r) => `<option value="${esc(r.nombre)}" ${r.nombre === rolActual ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select>
        </div>
        <p class="max-w-xl flex-1 self-center text-sm text-suave">${esc(rol.descripcion)}</p>
        <span id="chip-cambios" class="chip chip-aviso ${hayCambios() ? '' : 'hidden'}">Cambios sin guardar</span>
      </div>

      ${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar los permisos. Los cambios los hace Sistemas.')}</div>`}
      ${esAdmin ? `<div class="mt-4">${aviso('info', 'El Administrador siempre conserva el acceso a las pantallas de Sistemas para no quedarse sin forma de arreglar los permisos.')}</div>` : ''}

      <div class="mt-4 grid gap-4 xl:grid-cols-2">${tarjetasAreas}</div>

      <div class="mt-4">${tarjeta('Acciones con permiso', `<div class="grid gap-1 md:grid-cols-2">${acciones}</div>`)}</div>

      ${puedeAccionar ? `<div class="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-borde bg-fondo py-3">
        <p class="mr-auto text-xs text-suave">Los cambios se aplican la próxima vez que esta persona inicie sesión.</p>
        ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar', extra: hayCambios() ? '' : 'disabled' })}
        ${boton('Guardar', { id: 'guardar', extra: hayCambios() ? '' : 'disabled' })}
      </div>` : ''}`;

    document.getElementById('rol').addEventListener('change', async (e) => {
      if (hayCambios()) {
        const ok = await preguntar({ titulo: '¿Descartar los cambios?', mensaje: `Tienes cambios sin guardar en «${rolActual}». Si cambias de rol, se pierden.`, textoOk: 'Descartar', tipoOk: 'peligro' });
        if (!ok) return pintar();
      }
      rolActual = e.target.value;
      edicion = copiar(rolActual);
      original = JSON.stringify(edicion);
      pintar();
    });

    zona.querySelectorAll('[data-pantalla]').forEach((r) =>
      r.addEventListener('change', () => {
        if (r.value) edicion.permisos[r.dataset.pantalla] = r.value;
        else delete edicion.permisos[r.dataset.pantalla];
        actualizarBotones();
      }),
    );
    zona.querySelectorAll('[data-accion]').forEach((c) =>
      c.addEventListener('change', () => {
        const id = c.dataset.accion;
        edicion.acciones = c.checked ? [...new Set([...edicion.acciones, id])] : edicion.acciones.filter((x) => x !== id);
        actualizarBotones();
      }),
    );

    document.getElementById('cancelar')?.addEventListener('click', () => {
      edicion = copiar(rolActual);
      original = JSON.stringify(edicion);
      pintar();
    });
    document.getElementById('guardar')?.addEventListener('click', async () => {
      const b = document.getElementById('guardar');
      b.disabled = true;
      b.textContent = 'Guardando…';
      try {
        await guardarRol(rolActual, edicion);
        rol.permisos = { ...edicion.permisos };
        rol.acciones = [...edicion.acciones];
        original = JSON.stringify(edicion);
        mostrarAviso(`Se guardaron los permisos de «${rolActual}».`);
        pintar();
      } catch (error) {
        mostrarAviso(error.message, 'peligro');
        b.disabled = false;
        b.textContent = 'Guardar';
      }
    });
  }

  // Sin repintar todo (para no perder el scroll): solo activa o apaga los botones.
  function actualizarBotones() {
    const cambios = hayCambios();
    if (!puedeAccionar) return;
    document.getElementById('guardar').disabled = !cambios;
    document.getElementById('cancelar').disabled = !cambios;
    document.getElementById('chip-cambios').classList.toggle('hidden', !cambios);
  }

  pintar();
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
