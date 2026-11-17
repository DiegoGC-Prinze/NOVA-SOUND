// Pantalla: Sistemas · Área de tickets.
// Lista de tickets que levantaron las personas que no pudieron entrar. Se abren con «Ver ticket».

import { montarPagina, rutaA } from '../layout.js';
import { tickets } from '../api.js';
import { encabezado, tarjeta, tabla, chip, cargarEn } from '../componentes.js';
import { esc, diaRelativo } from '../ui.js';

const pagina = montarPagina('sistemas/area-de-tickets');

function iniciar({ sesion, contenido }) {
  contenido.innerHTML = `${encabezado(sesion, 'Área de tickets')}<div id="resultado" class="mt-4"></div>`;
  const zona = document.getElementById('resultado');

  cargarEn(zona, async () => {
    const lista = await tickets();
    return { html: '<div id="zona-tickets"></div>', listo: () => pintar(lista) };
  });
}

function pintar(lista) {
  const zona = document.getElementById('zona-tickets');
  let filtro = 'Abierto';

  function dibujar() {
    const abiertos = lista.filter((t) => t.estado === 'Abierto').length;
    const cerrados = lista.length - abiertos;
    const visibles = filtro === 'Todos' ? lista : lista.filter((t) => t.estado === filtro);

    const pestanas = [
      ['Abierto', `Abiertos (${abiertos})`],
      ['Cerrado', `Cerrados (${cerrados})`],
      ['Todos', `Todos (${lista.length})`],
    ]
      .map(([valor, texto]) => `<button type="button" data-filtro="${valor}" aria-pressed="${valor === filtro}" class="btn h-8 px-3 ${valor === filtro ? 'btn-principal' : 'btn-secundario'}">${texto}</button>`)
      .join('');

    const t = tabla({
      filas: visibles,
      vacio: filtro === 'Abierto' ? 'No hay tickets abiertos' : 'No hay tickets para mostrar',
      detalleVacio: 'Cuando alguien levante un ticket desde el login, aparecerá aquí.',
      columnas: [
        { titulo: 'Id', html: (x) => `<strong>${esc(x.id)}</strong>` },
        { titulo: 'N.º de empleado', campo: 'numEmpleado' },
        { titulo: 'Nombre', campo: 'nombre' },
        { titulo: 'Motivo', campo: 'motivo' },
        { titulo: 'Levantado', texto: (x) => `${diaRelativo(x.fecha)} ${x.hora}` },
        { titulo: 'Estado', html: (x) => chip(x.estado, x.estado === 'Abierto' ? 'aviso' : 'exito') },
        { titulo: '', html: (x) => `<a class="btn btn-secundario h-8 px-3" href="${rutaA(`pages/sistemas/ver-ticket.html?id=${encodeURIComponent(x.id)}`)}">Ver ticket</a>` },
      ],
    });

    zona.innerHTML = tarjeta('Tickets', t, {
      relleno: false,
      acciones: `<div class="flex gap-1" role="group" aria-label="Filtrar tickets por estado">${pestanas}</div>`,
    });
    zona.querySelectorAll('[data-filtro]').forEach((b) =>
      b.addEventListener('click', () => {
        filtro = b.dataset.filtro;
        dibujar();
      }),
    );
  }
  dibujar();
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
