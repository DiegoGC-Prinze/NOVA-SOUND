import { montarPagina } from '../layout.js';
import { ordenesProduccion, enviarOrdenProduccion } from '../api.js?v=ordenes-produccion-1';
import { encabezado, tarjeta, tabla, campo, boton, cargarEn, mostrarAviso, aviso } from '../componentes.js';

const pagina = montarPagina('gerencia/ordenes-de-produccion');

function iniciar({ sesion, contenido, puedeAccionar, puede }) {
  const editable = puedeAccionar && puede('enviar-orden-a-produccion');
  contenido.innerHTML = `${encabezado(sesion, 'Órdenes de producción')}<div id="ordenes-contenido" class="mt-4 space-y-4"></div>`;
  const zona = document.getElementById('ordenes-contenido');
  const cargar = () => cargarEn(zona, async () => {
    const d = await ordenesProduccion();
    const opciones = tipo => [{ valor: '', texto: 'Selecciona una opción' }, ...d[tipo].map(i => ({ valor: i.id, texto: i.nombre }))];
    const listo = ['clientes', 'modelos', 'colores', 'lineas'].every(tipo => d[tipo].length);
    const campos = [['cliente', 'Cliente', 'clientes'], ['modelo', 'Modelo', 'modelos'],
      ['color', 'Color', 'colores'], ['linea', 'Línea de producción', 'lineas']]
      .map(([id, etiqueta, tipo]) => campo({ id: `orden-${id}`, etiqueta, opciones: opciones(tipo), requerido: true })).join('');
    const formulario = editable && listo ? tarjeta('Nueva orden', `
      <p class="mb-4 text-sm text-suave">Al enviarla, Producción podrá seleccionarla para registrar unidades.</p>
      <form id="form-orden" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        ${campos}
        ${campo({ id: 'orden-cantidad', etiqueta: 'Cantidad de unidades', tipo: 'number', requerido: true, extra: 'min="1" max="2147483647" step="1"' })}
        ${campo({ id: 'orden-fecha', etiqueta: 'Fecha de compromiso', tipo: 'date', requerido: true, valor: d.fecha, extra: `min="${d.fecha}"` })}
        <div id="orden-error" class="hidden md:col-span-2 lg:col-span-3" role="alert"></div>
        <div class="md:col-span-2 lg:col-span-3">${boton('Enviar a Producción', { id: 'enviar-orden', enviar: true })}</div>
      </form>`) : aviso('info', editable
        ? 'Se requiere al menos un cliente, modelo, color y línea activos para enviar una orden.'
        : 'Tu rol solo puede consultar las órdenes de producción.');
    return { html: `${formulario}<div id="ordenes-listado" class="mt-4">${tarjeta('Órdenes disponibles en Producción', tabla({
      filas: [...d.ordenes].reverse(), vacio: 'Todavía no hay órdenes de producción.', columnas: [
        { titulo: 'Orden', campo: 'id' }, { titulo: 'Cliente', campo: 'cliente' },
        { titulo: 'Modelo', campo: 'modelo' }, { titulo: 'Color', campo: 'color' },
        { titulo: 'Línea', campo: 'linea' }, { titulo: 'Cantidad', campo: 'cantidad', num: true },
        { titulo: 'Compromiso', campo: 'fecha_compromiso' },
      ],
    }), { relleno: false })}</div>`, listo: () => {
      document.getElementById('form-orden')?.addEventListener('submit', async e => {
        e.preventDefault();
        const b = document.getElementById('enviar-orden');
        if (b.disabled) return;
        b.disabled = true;
        b.textContent = 'Enviando…';
        const error = document.getElementById('orden-error');
        error.classList.add('hidden');
        const valor = id => document.getElementById(`orden-${id}`).value;
        try {
          const orden = await enviarOrdenProduccion({
            id_cliente: Number(valor('cliente')), id_modelo: Number(valor('modelo')),
            id_color: Number(valor('color')), id_linea: Number(valor('linea')),
            cantidad: Number(valor('cantidad')), fecha_compromiso: valor('fecha'),
          });
          await cargar();
          mostrarAviso(`Orden ${orden.id} enviada a Producción.`);
        } catch (err) {
          error.textContent = err.message;
          error.classList.remove('hidden');
          b.disabled = false;
          b.textContent = 'Enviar a Producción';
        }
      });
    } };
  });
  cargar();
}

if (pagina) iniciar(pagina);
