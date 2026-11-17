import { montarPagina, rutaA } from '../layout.js';
import { consultarOperacion, operar } from '../api.js';
import { encabezado, aviso, campo, boton, tabla, tarjeta, chipUnidad, mostrarAviso } from '../componentes.js';
import { esc, descargarCSV } from '../ui.js';

export { rutaA, operar, campo, boton, tabla, tarjeta, aviso, esc, chipUnidad };
export const valor = id => document.getElementById(id)?.value.trim() || '';
export const enlace = (ruta, texto) => `<a class="btn btn-enlace" href="${esc(rutaA(ruta))}">${esc(texto)}</a>`;
export const formulario = (id, campos, acciones = '') => `<form id="${id}" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" novalidate>${campos}<div class="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">${acciones}</div></form>`;
export const estado = u => ({ titulo: 'Estado', html: f => chipUnidad(f[u || 'estado']) });
export const columnasUnidad = [
  { titulo: 'Serie', campo: 'serie' }, { titulo: 'Orden', campo: 'orden' }, { titulo: 'Modelo', campo: 'modelo' },
  { titulo: 'Color', campo: 'color' }, { titulo: 'Lote', campo: 'lote' }, { titulo: 'Línea', campo: 'linea' }, estado(),
];
export function exportar(nombre, filas, columnas) {
  descargarCSV(nombre, columnas.map(c => ({ titulo: c.titulo, valor: c.texto || (f => f[c.campo] ?? '') })), filas);
}

// El marco y los componentes visuales son los mismos del resto del frontend.
// Cada vista vuelve a consultar los datos después de una escritura confirmada.
export function iniciarOperacion(id, dibujar, { contexto = () => ({}) } = {}) {
  const p = montarPagina(id);
  if (!p) return;
  const ctx = { ...p, datos: null, vista: null };
  ctx.permite = (pantalla, accion) => p.sesion.permisos?.[pantalla] === 'acciona' && (!accion || p.puede(accion));
  ctx.error = e => {
    const zona = document.getElementById('error-operacion');
    if (zona) { zona.innerHTML = aviso('peligro', e.message || String(e)); zona.scrollIntoView({ block: 'nearest' }); }
    else mostrarAviso(e.message || String(e), 'peligro');
  };
  ctx.refrescar = async () => {
    try {
      ctx.datos = await consultarOperacion(p.pantalla.area, contexto());
      p.contenido.innerHTML = `${encabezado(p.sesion, p.pantalla.nombre)}<p class="mt-2 text-xs text-suave">${ctx.datos.real ? 'Datos de PostgreSQL' : 'Datos de demostración en este navegador'}</p><div id="error-operacion" class="mt-3" aria-live="assertive"></div><div id="vista-operacion" class="mt-4 space-y-4"></div>`;
      ctx.vista = document.getElementById('vista-operacion');
      await dibujar(ctx);
    } catch (e) { ctx.error(e); }
  };
  ctx.escribir = async (accion, datos, mensaje, despues) => {
    const r = await operar(accion, datos, p.pantalla.area);
    if (despues) despues(r);
    await ctx.refrescar();
    mostrarAviso(mensaje || 'Cambios guardados.');
    return r;
  };
  ctx.evento = (selector, tipo, handler) => {
    ctx.vista.querySelectorAll(selector).forEach(el => el.addEventListener(tipo, async e => {
      if (tipo === 'submit') e.preventDefault();
      if (el.dataset.ocupado) return;
      el.dataset.ocupado = '1';
      const botones = tipo === 'submit' ? [...el.querySelectorAll('button[type=submit]')] : (el.tagName === 'BUTTON' ? [el] : []);
      const estados = botones.map(b => b.disabled); botones.forEach(b => { b.disabled = true; });
      try { await handler(e, el); } catch (err) { ctx.error(err); }
      finally { delete el.dataset.ocupado; botones.forEach((b, i) => { b.disabled = estados[i]; }); }
    }));
  };
  ctx.refrescar();
}
