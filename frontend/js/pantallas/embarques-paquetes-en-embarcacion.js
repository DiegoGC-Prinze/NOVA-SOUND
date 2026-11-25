import { iniciarOperacion } from './operacion-comun.js';
import {
  tarjeta,
  tabla,
  campo,
  chip,
  indicador,
  boton,
  aviso,
} from '../componentes.js';
import { esc } from '../ui.js';

let filtroEmbarque = '';
let filtroEstiba = '';

iniciarOperacion('embarques/paquetes-en-embarcacion', c => {
  const { datos, vista, puedeAccionar } = c;
  const embarques = new Map(datos.embarques.map(e => [e.id, e]));
  const paquetes = datos.cajas.filter(b => embarques.has(b.embarque)).map(b => {
    const e = embarques.get(b.embarque);
    return {
      embarque: e.id, unidadTransporte: e.contenedor || e.referencia, caja: b.id,
      cliente: b.cliente, modelo: b.modelo, piezas: b.cantidad ?? b.unidades.length,
      estiba: b.estibaVerificada ? 'Verificada' : 'Pendiente',
    };
  });

  const embarquesUnicos = [...new Set(paquetes.map((p) => p.embarque))];

  vista.innerHTML = `
    ${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar la carga en embarcación.')}</div>`}

    <div id="resumen-carga" class="mt-4"></div>

    <div class="mt-4">
      ${tarjeta(
        'Manifiesto de carga por unidad',
        `<div class="mb-4 flex flex-wrap items-end gap-3">
          ${campo({
            id: 'filtro-emb',
            etiqueta: 'Embarque',
            opciones: [{ valor: '', texto: 'Todos los embarques' }, ...embarquesUnicos.map((e) => ({ valor: e, texto: e }))],
            valor: filtroEmbarque,
            clase: 'w-56',
          })}
          ${campo({
            id: 'filtro-estiba',
            etiqueta: 'Estado de estiba',
            opciones: [
              { valor: '', texto: 'Todos' },
              { valor: 'Verificada', texto: 'Verificada' },
              { valor: 'Pendiente', texto: 'Pendiente' },
            ],
            valor: filtroEstiba,
            clase: 'w-48',
          })}
        </div>
        <div id="zona-tabla"></div>`
      )}
    </div>`;

  function pintar() {
    const filtrados = paquetes.filter(
      (p) => (!filtroEmbarque || p.embarque === filtroEmbarque) && (!filtroEstiba || p.estiba === filtroEstiba)
    );

    const verificados = paquetes.filter((p) => p.estiba === 'Verificada').length;
    const pendientes = paquetes.filter((p) => p.estiba === 'Pendiente').length;
    const totalPiezas = paquetes.reduce((acc, p) => acc + p.piezas, 0);

    document.getElementById('resumen-carga').innerHTML = `
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        ${indicador({ titulo: 'Paquetes verificados', valor: String(verificados), nota: 'Estibados y escaneados', tono: 'exito' })}
        ${indicador({ titulo: 'Pendientes de verificación', valor: String(pendientes), nota: 'Por confirmar en anden', tono: 'aviso' })}
        ${indicador({ titulo: 'Piezas totales en unidades', valor: String(totalPiezas), nota: 'Distribuidas en transporte', tono: 'marca' })}
      </div>`;

    document.getElementById('zona-tabla').innerHTML = tabla({
      filas: filtrados,
      vacio: 'No hay paquetes con los filtros seleccionados',
      columnas: [
        { titulo: 'Embarque', html: (p) => `<strong class="text-marca-osc">${esc(p.embarque)}</strong>` },
        { titulo: 'Transporte', campo: 'unidadTransporte' },
        { titulo: 'Caja', html: (p) => `<strong class="tabular-nums">${esc(p.caja)}</strong>` },
        { titulo: 'Cliente', campo: 'cliente' },
        { titulo: 'Modelo', campo: 'modelo' },
        { titulo: 'Piezas', num: true, texto: (p) => `${p.piezas}` },
        {
          titulo: 'Estiba',
          html: (p) => chip(p.estiba, p.estiba === 'Verificada' ? 'exito' : 'aviso'),
        },
        {
          titulo: 'Acción',
          num: true,
          html: (p) => {
            if (p.estiba === 'Verificada') return '<span class="text-xs text-suave">Listo</span>';
            if (!puedeAccionar) return '<span class="text-xs text-suave">—</span>';
            return boton('Verificar estiba', { tipo: 'secundario', extra: `data-verificar="${esc(p.caja)}"` });
          },
        },
      ],
    });
    c.evento('[data-verificar]', 'click', async (_e, btn) => {
      if (!puedeAccionar) return;
      const item = paquetes.find(p => p.caja === btn.dataset.verificar);
      if (item) await c.escribir('verificarEstiba', { caja: item.caja, embarque: item.embarque },
        `Estiba de caja ${item.caja} verificada.`);
    });
  }

  document.getElementById('filtro-emb').addEventListener('change', (e) => {
    filtroEmbarque = e.target.value;
    pintar();
  });

  document.getElementById('filtro-estiba').addEventListener('change', (e) => {
    filtroEstiba = e.target.value;
    pintar();
  });

  pintar();
});
