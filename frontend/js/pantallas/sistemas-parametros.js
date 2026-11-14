// Pantalla: Sistemas · Parámetros.
// Capacidad estándar de unidades por caja, según el modelo (regla del caso: una caja no mezcla modelos).
// Todo cambio pide un motivo: así queda quién, cuándo, qué cambió y por qué.

import { montarPagina } from '../layout.js';
import { parametros, guardarParametros } from '../api.js';
import { encabezado, tarjeta, campo, marcarError, boton, aviso, cargarEn, mostrarAviso } from '../componentes.js';
import { esc, fechaCorta } from '../ui.js';

const pagina = montarPagina('sistemas/parametros');

function iniciar({ sesion, contenido, puedeAccionar }) {
  contenido.innerHTML = `${encabezado(sesion, 'Parámetros')}${puedeAccionar ? '' : `<div class="mt-4">${aviso('info', 'Tu rol solo puede consultar los parámetros. Los cambios los hace Sistemas.')}</div>`}<div id="resultado" class="mt-4"></div>`;
  const zona = document.getElementById('resultado');

  const cargar = () =>
    cargarEn(zona, async () => {
      const p = await parametros();
      return { html: htmlParametros(p, puedeAccionar), listo: () => conectar(p, cargar, puedeAccionar) };
    });
  cargar();
}

function htmlParametros(p, puedeAccionar) {
  const campos = Object.entries(p.capacidadCaja)
    .map(([modelo, cantidad]) => campo({ id: `cap-${modelo}`, etiqueta: modelo, tipo: 'number', valor: cantidad, extra: `min="1" max="999" step="1" inputmode="numeric" ${puedeAccionar ? '' : 'disabled'}`, clase: 'w-36' }))
    .join('');
  const c = p.ultimoCambio;

  return `
    <form id="form-parametros" class="max-w-3xl" novalidate>
      ${tarjeta(
        'Capacidad de caja por modelo',
        `<p class="mb-4 text-sm text-suave">Unidades que caben en una caja estándar de cada modelo.</p>
         <div class="flex flex-wrap gap-4">${campos}</div>
         ${puedeAccionar ? `<div class="mt-4">${campo({ id: 'motivo', etiqueta: 'Motivo del cambio', tipo: 'textarea', requerido: true, ayuda: 'Se guarda junto con tu nombre y la hora.' })}</div>` : ''}
         <p class="mt-5 text-xs text-suave">Último cambio: <strong class="text-texto">${esc(c.por)}</strong>, ${esc(fechaCorta(c.fecha))} ${esc(c.hora)}. «${esc(c.motivo)}»</p>
         ${puedeAccionar ? `<div class="mt-3 flex justify-end gap-2">
           ${boton('Cancelar', { tipo: 'secundario', id: 'cancelar' })}
           ${boton('Guardar', { enviar: true, id: 'guardar' })}
         </div>` : ''}`,
      )}
    </form>`;
}

function conectar(p, recargar, puedeAccionar) {
  if (!puedeAccionar) return; // solo consulta: no hay nada que guardar
  document.getElementById('cancelar').addEventListener('click', recargar);

  document.getElementById('form-parametros').addEventListener('submit', async (e) => {
    e.preventDefault();
    const capacidadCaja = {};
    let hayError = false;
    Object.keys(p.capacidadCaja).forEach((modelo) => {
      const valor = Number(document.getElementById(`cap-${modelo}`).value);
      const valido = Number.isInteger(valor) && valor >= 1 && valor <= 999;
      marcarError(`cap-${modelo}`, valido ? '' : 'Número entero de 1 a 999.');
      if (!valido) hayError = true;
      capacidadCaja[modelo] = valor;
    });
    const motivo = document.getElementById('motivo').value.trim();
    const cambio = Object.keys(capacidadCaja).some((m) => capacidadCaja[m] !== p.capacidadCaja[m]);

    marcarError('motivo', '');
    if (!hayError && !cambio) return mostrarAviso('No hay cambios que guardar.', 'info');
    if (!motivo) {
      marcarError('motivo', 'Escribe por qué cambias la capacidad.');
      hayError = true;
    }
    if (hayError) return;

    const b = document.getElementById('guardar');
    b.disabled = true;
    b.textContent = 'Guardando…';
    try {
      await guardarParametros({ capacidadCaja, motivo });
      mostrarAviso('Los parámetros se guardaron.');
      recargar();
    } catch (error) {
      mostrarAviso(error.message, 'peligro');
      b.disabled = false;
      b.textContent = 'Guardar';
    }
  });
}

// Se arranca al final del archivo para que todas las constantes de arriba ya existan.
if (pagina) iniciar(pagina);
