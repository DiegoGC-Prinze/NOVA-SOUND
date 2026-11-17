// Pantalla: Sistemas · Catálogos.
// Se elige un catálogo (modelos, líneas, turnos, defectos…) y se ven sus elementos con código, nombre y estado.
// «Nuevo» abre el formulario; «Registrar» lo guarda; «Cancelar» lo cierra.
// Un elemento no se borra: se desactiva, para no perder el historial.

import { montarPagina } from '../layout.js';
import { catalogos, guardarElementoCatalogo, cambiarEstadoCatalogo } from '../api.js';
import { encabezado, tarjeta, tabla, chip, campo, marcarError, boton, aviso, cargarEn, mostrarAviso } from '../componentes.js';
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

  function pintar() {
    const catalogo = datos[tipo];

    const filas = tabla({
      filas: catalogo.items,
      vacio: 'Este catálogo todavía no tiene elementos',
      detalleVacio: puedeAccionar ? 'Usa «Nuevo» para agregar el primero.' : '',
      columnas: [
        { titulo: 'Código', html: (i) => `<strong class="tabular-nums">${esc(i.codigo)}</strong>` },
        { titulo: 'Nombre', campo: 'nombre' },
        { titulo: 'Estado', html: (i) => chip(i.estado, i.estado === 'Activo' ? 'exito' : 'neutro') },
        // Activar / Desactivar solo si el rol puede accionar.
        ...(puedeAccionar ? [{ titulo: '', html: (i) => `<button type="button" class="btn btn-secundario h-8 px-3" data-alternar="${esc(i.codigo)}">${i.estado === 'Activo' ? 'Desactivar' : 'Activar'}</button>` }] : []),
      ],
    });

    const formulario = formularioAbierto && puedeAccionar
      ? `<form id="form-nuevo" class="tarjeta mb-4 p-4" novalidate>
           <h2 class="mb-3">Nuevo elemento de «${esc(catalogo.nombre)}»</h2>
           <div id="error-general" class="aviso aviso-peligro mb-3 hidden" role="alert"></div>
           <div class="grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-start">
             ${campo({ id: 'codigo', etiqueta: 'Código', requerido: true, extra: 'autocomplete="off" autofocus' })}
             ${campo({ id: 'nombre', etiqueta: 'Nombre', requerido: true, extra: 'autocomplete="off"' })}
             <div class="flex gap-2 md:pt-5">
               ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar-nuevo' })}
               ${boton('Registrar', { enviar: true, id: 'registrar' })}
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
        <div class="ml-auto">${formularioAbierto || !puedeAccionar ? '' : boton('+ Nuevo', { id: 'nuevo' })}</div>
      </div>
      <div class="mt-4">${formulario}${tarjeta(`${catalogo.nombre} (${catalogo.items.length})`, filas, { relleno: false })}</div>`;

    document.getElementById('tipo').addEventListener('change', (e) => {
      tipo = e.target.value;
      formularioAbierto = false;
      pintar();
    });
    document.getElementById('nuevo')?.addEventListener('click', () => {
      formularioAbierto = true;
      pintar();
    });
    document.getElementById('cancelar-nuevo')?.addEventListener('click', () => {
      formularioAbierto = false;
      pintar();
    });

    document.getElementById('form-nuevo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const elemento = { codigo: document.getElementById('codigo').value.trim(), nombre: document.getElementById('nombre').value.trim(), estado: 'Activo' };
      marcarError('codigo', elemento.codigo ? '' : 'Escribe el código.');
      marcarError('nombre', elemento.nombre ? '' : 'Escribe el nombre.');
      if (!elemento.codigo || !elemento.nombre) return;

      const b = document.getElementById('registrar');
      b.disabled = true;
      b.textContent = 'Registrando…';
      try {
        await guardarElementoCatalogo(tipo, elemento);
        catalogo.items.push(elemento);
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
