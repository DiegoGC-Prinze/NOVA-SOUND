import { iniciarOperacion, campo, boton, tabla, tarjeta, formulario, valor, enlace, columnasUnidad, exportar, esc, chipUnidad, aviso } from './operacion-comun.js';
import { indicador } from '../componentes.js';
import { fechaRelativa } from '../ui.js';

const PRUEBAS = { encendido: 'Encendido', audio: 'Audio', carga: 'Carga', bluetooth: 'Bluetooth' };
export function iniciarPruebas(id) {
  let consulta = new URLSearchParams(location.search).get('unidad') || '';
  let filtros = { serie: '', modelo: '', estado: '', desde: '', hasta: '' };
  iniciarOperacion(id, async c => {
    const d = c.datos, vista = id.split('/')[1];
    const linkPrueba = u => c.sesion.permisos['prueba-funcional/registro-de-pruebas-funcionales'] && ['ENSAMBLADA', 'FALLA_FUNCIONAL'].includes(u.estado) ? enlace(`pages/prueba-funcional/registro-de-pruebas-funcionales.html?unidad=${encodeURIComponent(u.serie)}`, 'Registrar prueba') : '';
    const buscar = () => formulario('form-buscar', campo({ id: 'pf-buscar', etiqueta: 'Serie o lote', valor: consulta, requerido: true, placeholder: 'Escanea o escribe el código' }), boton('Buscar', { enviar: true }));
    if (vista === 'escanear-pieza-o-lote') {
      const encontradas = consulta ? d.unidades.filter(u => u.serie.toUpperCase() === consulta.toUpperCase() || u.lote.toUpperCase() === consulta.toUpperCase()) : [];
      c.vista.innerHTML = `${tarjeta('Escanear pieza o lote', buscar())}${consulta ? tarjeta('Unidades encontradas', tabla({ filas: encontradas, columnas: [...columnasUnidad, { titulo: 'Acción', html: linkPrueba }], vacio: 'No se encontró ese código. Registra primero la unidad en Producción.' })) : aviso('info', 'Las unidades registradas en Producción aparecen aquí automáticamente.')}`;
      c.evento('#form-buscar', 'submit', () => { consulta = valor('pf-buscar'); return c.refrescar(); }); return;
    }
    if (vista === 'registro-de-pruebas-funcionales') {
      const u = d.unidades.find(u => u.serie.toUpperCase() === consulta.toUpperCase());
      c.vista.innerHTML = tarjeta('Unidad por probar', buscar());
      c.evento('#form-buscar', 'submit', () => { consulta = valor('pf-buscar'); history.replaceState(null, '', `?unidad=${encodeURIComponent(consulta)}`); return c.refrescar(); });
      if (!u) { c.vista.insertAdjacentHTML('beforeend', aviso('info', consulta ? 'La unidad no existe. Regístrala primero en Producción.' : 'Selecciona una unidad desde la cola o busca su número de serie.')); return; }
      const disponible = ['ENSAMBLADA', 'FALLA_FUNCIONAL'].includes(u.estado);
      c.vista.insertAdjacentHTML('beforeend', tarjeta(u.serie, `<p>${esc(u.orden)} · ${esc(u.modelo)} · ${esc(u.color)} · ${esc(u.lote)}</p><div class="mt-2">${chipUnidad(u.estado)}</div>`));
      if (!disponible || !c.puedeAccionar) {
        c.vista.insertAdjacentHTML('beforeend', tarjeta('Resultado registrado', tabla({ filas: Object.entries(u.prueba || {}).map(([prueba, resultado]) => ({ prueba: PRUEBAS[prueba] || prueba, resultado })), columnas: [{ titulo: 'Prueba', campo: 'prueba' }, { titulo: 'Resultado', campo: 'resultado' }] })));
        if (u.estado === 'PROBADA') c.vista.insertAdjacentHTML('beforeend', aviso('exito', 'Prueba aprobada y guardada. La unidad ya está disponible para inspección de Calidad.'));
        return;
      }
      const radios = Object.entries(PRUEBAS).map(([k, label]) => `<fieldset class="rounded-lg border border-borde p-3"><legend class="font-semibold">${label}</legend>${['Aprobada', 'Falla'].map(v => `<label class="mr-4 inline-flex gap-2"><input type="radio" name="prueba-${k}" value="${v}">${v}</label>`).join('')}</fieldset>`).join('');
      c.vista.insertAdjacentHTML('beforeend', tarjeta('Evaluación funcional', formulario('form-prueba', radios + campo({ id: 'obs-operador', etiqueta: 'Observaciones (obligatorias si hay fallas)', tipo: 'textarea' }), boton('Guardar resultado', { id: 'btn-guardar', enviar: true }))));
      c.evento('#form-prueba', 'submit', async () => {
        const prueba = Object.fromEntries(Object.keys(PRUEBAS).map(k => [k, document.querySelector(`input[name="prueba-${k}"]:checked`)?.value || '']));
        const aprobada = Object.values(prueba).every(v => v === 'Aprobada');
        await c.escribir('guardarPrueba', { serie: u.serie, prueba, observaciones: valor('obs-operador') }, aprobada ? 'Resultado guardado. Unidad enviada a la cola de Calidad.' : 'Falla registrada. La unidad queda disponible para repetir la prueba después de corregirla.');
      }); return;
    }
    const esCola = vista === 'unidades-por-probar';
    const iniciales = d.unidades.filter(u => Object.keys(u.prueba || {}).length && !d.pruebas.some(p => p.serie === u.serie)).map(u => {
      const h = u.historial.find(h => h.area === 'Prueba funcional');
      return { serie: u.serie, lote: u.lote, modelo: u.modelo, linea: u.linea, fecha: h?.fecha || fechaRelativa(-(h?.dia ?? u.dia)), hora: h?.hora || u.hora, usuario: h?.usuario || 'Registro de ejemplo', resultado: Object.values(u.prueba).includes('Falla') ? 'Rechazada' : 'Aprobada' };
    });
    const lista = esCola ? d.unidades.filter(u => ['ENSAMBLADA', 'FALLA_FUNCIONAL'].includes(u.estado)) : [...iniciales, ...d.pruebas].reverse();
    const filas = lista.filter(u => (!filtros.serie || `${u.serie} ${u.lote}`.toLowerCase().includes(filtros.serie.toLowerCase())) && (!filtros.modelo || u.modelo === filtros.modelo) && (!filtros.estado || (u.estado || u.resultado) === filtros.estado) && (!filtros.desde || u.fecha >= filtros.desde) && (!filtros.hasta || u.fecha <= filtros.hasta));
    const cols = esCola ? [...columnasUnidad, { titulo: 'Acción', html: linkPrueba }] : [{ titulo: 'Fecha', campo: 'fecha' }, { titulo: 'Hora', campo: 'hora' }, { titulo: 'Serie', campo: 'serie' }, { titulo: 'Modelo', campo: 'modelo' }, { titulo: 'Lote', campo: 'lote' }, { titulo: 'Resultado', campo: 'resultado' }, { titulo: 'Responsable', campo: 'usuario' }, { titulo: 'Observaciones', campo: 'observaciones' }];
    const campos = campo({ id: 'f-serie', etiqueta: 'Serie o lote', valor: filtros.serie }) + campo({ id: 'f-modelo', etiqueta: 'Modelo', valor: filtros.modelo, opciones: [{ valor: '', texto: 'Todos' }, ...Object.keys(d.parametros.capacidadCaja)] }) +
      campo({ id: 'f-estado', etiqueta: 'Estado', valor: filtros.estado, opciones: [{ valor: '', texto: 'Todos' }, ...(esCola ? ['ENSAMBLADA', 'FALLA_FUNCIONAL'] : ['Aprobada', 'Rechazada'])] }) +
      (esCola ? '' : campo({ id: 'f-desde', etiqueta: 'Desde', tipo: 'date', valor: filtros.desde }) + campo({ id: 'f-hasta', etiqueta: 'Hasta', tipo: 'date', valor: filtros.hasta }));
    c.vista.innerHTML = `${tarjeta('Filtros', formulario('form-filtros', campos, boton('Filtrar', { enviar: true }) + boton('Limpiar', { id: 'limpiar' }) + boton('Exportar CSV', { id: 'exportar' })))}
      <div class="grid gap-3 sm:grid-cols-3">${indicador({ titulo: esCola ? 'Pendientes' : 'Pruebas listadas', valor: filas.length })}${indicador({ titulo: d.real ? 'Pruebas aprobadas' : 'Aprobadas en esta demo', valor: d.pruebas.filter(p => p.resultado === 'Aprobada').length, tono: 'exito' })}${indicador({ titulo: 'Con falla funcional', valor: d.unidades.filter(u => u.estado === 'FALLA_FUNCIONAL').length, tono: 'aviso' })}</div>${tarjeta(esCola ? 'Unidades por probar' : 'Historial de pruebas', tabla({ filas, columnas: cols }))}`;
    c.evento('#form-filtros', 'submit', () => { if (valor('f-desde') && valor('f-hasta') && valor('f-desde') > valor('f-hasta')) throw new Error('La fecha inicial no puede ser posterior a la final.'); filtros = { serie: valor('f-serie'), modelo: valor('f-modelo'), estado: valor('f-estado'), desde: valor('f-desde'), hasta: valor('f-hasta') }; return c.refrescar(); });
    c.evento('#limpiar', 'click', () => { filtros = { serie: '', modelo: '', estado: '', desde: '', hasta: '' }; return c.refrescar(); });
    c.evento('#exportar', 'click', () => exportar('pruebas-funcionales.csv', filas, cols.filter(c => c.campo)));
  });
}
