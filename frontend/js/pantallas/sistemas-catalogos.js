// Pantalla: Sistemas · Catálogos.
// Se elige un catálogo (modelos, líneas, turnos, defectos…) y se ven sus elementos con código, nombre y estado.
// «Nuevo» abre el formulario; «Registrar» lo guarda; «Cancelar» lo cierra.
// Un elemento no se borra: se desactiva, para no perder el historial.

import { montarPagina } from '../layout.js';
import { catalogos, guardarElementoCatalogo, cambiarEstadoCatalogo, guardarRolCatalogo, eliminarRolCatalogo } from '../api.js?v=roles-catalogo-1';
import { encabezado, tarjeta, tabla, chip, campo, marcarError, boton, aviso, cargarEn, mostrarAviso, preguntar } from '../componentes.js';
import { esc } from '../ui.js';

const pagina = montarPagina('sistemas/catalogos');

function iniciar({ sesion, contenido, puedeAccionar }) {
  contenido.innerHTML = `${encabezado(sesion, 'Catálogos')}${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar los catálogos. Agregar, activar o desactivar elementos lo hace Sistemas.')}</div>`}<div id="resultado" class="mt-4"></div>`;
  const zona = document.getElementById('resultado');

  cargarEn(zona, async () => {
    const datos = await catalogos();
    return { html: '<div id="editor"></div>', listo: () => editor(datos, puedeAccionar) };
  });
}

function editor(datos, puedeAccionar) {
  const zona = document.getElementById('editor');
  let tipo = Object.keys(datos)[0];
  let formularioAbierto = false;
  let rolEditado = null;

  function pintar() {
    const catalogo = datos[tipo];
    const puedeEditar = puedeAccionar;
    const esRoles = tipo === 'roles';

    const filas = tabla({
      filas: catalogo.items,
      vacio: 'Este catálogo todavía no tiene elementos',
      detalleVacio: puedeEditar ? 'Usa «Nuevo» para agregar el primero.' : '',
      columnas: [
        { titulo: 'Código', html: (i) => `<strong class="tabular-nums">${esc(i.codigo)}</strong>` },
        { titulo: 'Nombre', campo: 'nombre' },
        { titulo: 'Estado', html: (i) => chip(i.estado, i.estado === 'Activo' ? 'exito' : 'neutro') },
        ...(esRoles ? [{ titulo: 'Descripción', campo: 'descripcion' }] : []),
        ...(esRoles && puedeEditar ? [{ titulo: 'Acciones', html: i => i.editable
          ? boton('Editar', { tipo: 'secundario', extra: `data-editar-rol="${esc(i.codigo)}"` }) + boton('Eliminar', { tipo: 'secundario', extra: `data-eliminar-rol="${esc(i.codigo)}"` })
          : '' }] : []),
        ...(puedeEditar && !esRoles ? [{ titulo: '', html: (i) => `<button type="button" class="btn btn-secundario h-8 px-3" data-alternar="${esc(i.codigo)}">${i.estado === 'Activo' ? 'Desactivar' : 'Activar'}</button>` }] : []),
      ],
    });

    const formulario = formularioAbierto && puedeEditar
      ? `<form id="form-nuevo" class="tarjeta mb-4 p-4" novalidate>
           <h2 class="mb-3">${esRoles ? (rolEditado ? "Editar rol" : "Nuevo rol") : `Nuevo elemento de «${esc(catalogo.nombre)}»`}</h2>
           <div id="error-general" class="aviso aviso-peligro mb-3 hidden" role="alert"></div>
           <div class="grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-start">
             ${esRoles ? '' : campo({ id: 'codigo', etiqueta: 'Código', requerido: true, extra: 'autocomplete="off" autofocus' })}
             ${campo({ id: 'nombre', etiqueta: 'Nombre', valor: rolEditado?.nombre || '', requerido: true, extra: 'autocomplete="off"' })}
             ${esRoles ? campo({ id: 'descripcion-rol', etiqueta: 'Descripción', valor: rolEditado?.descripcion || '', tipo: 'textarea',
                ayuda: 'El rol Administrador recibe todos los permisos al crearse.', extra: 'maxlength="500"' }) : ''}
             <div class="flex gap-2 md:pt-5">
               ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar-nuevo' })}
               ${boton(rolEditado ? 'Guardar' : 'Registrar', { enviar: true, id: 'registrar' })}
             </div>
           </div>
         </form>`
      : '';

    zona.innerHTML = `
      <div class="tarjeta flex flex-wrap items-end gap-3 p-3">
        <div class="w-72">
          <label class="etiqueta" for="tipo">Tipo de catálogo</label>
          <select id="tipo" class="campo">${Object.entries(datos).map(([clave, c]) => `<option value="${esc(clave)}" ${clave === tipo ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
        </div>
        <div class="ml-auto">${formularioAbierto || !puedeEditar ? '' : boton('+ Nuevo', { id: 'nuevo' })}</div>
      </div>
      <div class="mt-4">${formulario}${tarjeta(`${catalogo.nombre} (${catalogo.items.length})`, filas, { relleno: false })}</div>`;

    document.getElementById('tipo').addEventListener('change', (e) => {
      tipo = e.target.value;
      formularioAbierto = false;
      rolEditado = null;
      pintar();
    });
    document.getElementById('nuevo')?.addEventListener('click', () => {
      formularioAbierto = true;
      pintar();
    });
    document.getElementById('cancelar-nuevo')?.addEventListener('click', () => {
      formularioAbierto = false;
      rolEditado = null;
      pintar();
    });

    document.getElementById('form-nuevo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const elemento = { codigo: document.getElementById('codigo')?.value.trim(), nombre: document.getElementById('nombre').value.trim(), estado: 'Activo' };
      if (!esRoles) marcarError('codigo', elemento.codigo ? '' : 'Escribe el código.');
      marcarError('nombre', elemento.nombre ? '' : 'Escribe el nombre.');
      if ((!esRoles && !elemento.codigo) || !elemento.nombre) return;

      const b = document.getElementById('registrar');
      b.disabled = true;
      b.textContent = 'Registrando…';
      try {
        if (esRoles) {
          const descripcion = document.getElementById('descripcion-rol').value;
          await guardarRolCatalogo({ nombre: elemento.nombre, descripcion }, rolEditado?.codigo);
          datos.roles = (await catalogos()).roles;
        } else {
          await guardarElementoCatalogo(tipo, elemento);
          catalogo.items.push(elemento);
        }
        rolEditado = null;
        formularioAbierto = false;
        mostrarAviso(`Se registró «${elemento.nombre}».`);
        pintar();
      } catch (error) {
        const caja = document.getElementById('error-general');
        caja.textContent = error.message;
        caja.classList.remove('hidden');
        b.disabled = false;
        b.textContent = 'Registrar';
      }
    });

    zona.querySelectorAll('[data-editar-rol]').forEach(b => b.addEventListener('click', () => {
      rolEditado = catalogo.items.find(i => i.codigo === b.dataset.editarRol);
      formularioAbierto = true;
      pintar();
    }));
    zona.querySelectorAll('[data-eliminar-rol]').forEach(b => b.addEventListener('click', async () => {
      const rol = catalogo.items.find(i => i.codigo === b.dataset.eliminarRol);
      if (!await preguntar({ titulo: 'Eliminar rol', mensaje: `¿Eliminar «${rol.nombre}»?`, textoOk: 'Eliminar' })) return;
      b.disabled = true;
      try {
        await eliminarRolCatalogo(rol.codigo);
        catalogo.items = catalogo.items.filter(i => i !== rol);
        formularioAbierto = false;
        rolEditado = null;
        pintar();
      } catch (error) {
        mostrarAviso(error.message, 'peligro');
        b.disabled = false;
      }
    }));

    zona.querySelectorAll('[data-alternar]').forEach((b) =>
      b.addEventListener('click', async () => {
        const item = catalogo.items.find((i) => i.codigo === b.dataset.alternar);
        const nuevoEstado = item.estado === 'Activo' ? 'Inactivo' : 'Activo';
        b.disabled = true;
        try {
          await cambiarEstadoCatalogo(tipo, item.codigo, nuevoEstado);
          item.estado = nuevoEstado;
          pintar();
        } catch (error) {
          mostrarAviso(error.message, 'peligro');
          b.disabled = false;
        }
      }),
    );
  }
  pintar();
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
