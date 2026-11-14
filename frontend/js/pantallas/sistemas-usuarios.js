// Pantalla: Sistemas · Usuarios.
// Búsqueda de usuarios y tabla con número de empleado, nombre, rol y estado. Desde aquí se crea o se edita.

import { montarPagina, rutaA } from '../layout.js';
import { usuarios } from '../api.js';
import { encabezado, tarjeta, tabla, chip, boton, aviso, cargarEn } from '../componentes.js';
import { esc } from '../ui.js';

const pagina = montarPagina('sistemas/usuarios');

const FORMULARIO = (id = '') => rutaA(`pages/sistemas/nuevo-o-editar-usuario.html${id ? `?id=${encodeURIComponent(id)}` : ''}`);
const ESTADOS = { Activo: 'exito', Bloqueado: 'peligro', Inactivo: 'neutro' };

function iniciar({ sesion, contenido, puedeAccionar }) {
  contenido.innerHTML = `
    ${encabezado(sesion, 'Usuarios', puedeAccionar ? `<a class="btn btn-principal" href="${FORMULARIO()}">+ Nuevo usuario</a>` : '')}
    ${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar los usuarios. Crear o editar cuentas lo hace Sistemas.')}</div>`}
    <form id="form-busqueda" class="tarjeta mt-4 flex flex-wrap items-end gap-3 p-3" role="search">
      <div class="min-w-64 flex-1 sm:max-w-md">
        <label class="etiqueta" for="q">Buscar usuario</label>
        <input id="q" type="search" class="campo" placeholder="Número de empleado, nombre o rol" autocomplete="off">
      </div>
      ${boton('Buscar', { enviar: true })}
      ${boton('Limpiar', { tipo: 'secundario', id: 'limpiar' })}
    </form>
    <div id="resultado" class="mt-4"></div>`;

  const zona = document.getElementById('resultado');
  const entrada = document.getElementById('q');

  const cargar = () =>
    cargarEn(zona, async () => {
      const lista = await usuarios(entrada.value.trim());
      const t = tabla({
        filas: lista,
        vacio: 'No se encontró ningún usuario',
        detalleVacio: 'Prueba con otro número de empleado, nombre o rol.',
        columnas: [
          { titulo: 'N.º de empleado', html: (u) => `<strong class="tabular-nums">${esc(u.numEmpleado)}</strong>` },
          { titulo: 'Nombre', campo: 'nombre' },
          { titulo: 'Rol', campo: 'rol' },
          { titulo: 'Estado', html: (u) => chip(u.estado, ESTADOS[u.estado] || 'neutro') },
          // Editar solo aparece si el rol puede accionar en esta pantalla.
          ...(puedeAccionar ? [{ titulo: '', html: (u) => `<a class="btn btn-secundario h-8 px-3" href="${FORMULARIO(u.numEmpleado)}" aria-label="Editar a ${esc(u.nombre)}">Editar</a>` }] : []),
        ],
      });
      return tarjeta(`Usuarios (${lista.length})`, t, { relleno: false });
    });

  document.getElementById('form-busqueda').addEventListener('submit', (e) => {
    e.preventDefault();
    cargar();
  });
  document.getElementById('limpiar').addEventListener('click', () => {
    entrada.value = '';
    cargar();
  });
  cargar();
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
