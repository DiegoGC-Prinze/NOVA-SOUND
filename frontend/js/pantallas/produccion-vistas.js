import { iniciarOperacion, campo, boton, tabla, tarjeta, formulario, valor, enlace, columnasUnidad, exportar, esc } from './operacion-comun.js';
import { indicador, preguntar, chip } from '../componentes.js';
import { hoyISO } from '../ui.js';

const turnosDemo = [{ valor: 1, texto: 'Turno 1' }, { valor: 2, texto: 'Turno 2' }];
const suma = (filas, k) => filas.reduce((s, f) => s + Number(f[k] || 0), 0);
const opcionesOrden = d => d.ordenes.map(o => ({ valor: o.id, texto: `${o.id} · ${o.modelo} · ${o.cliente}` }));

export function iniciarProduccion(id) {
  let filtros = { linea: '', turno: '' };
  iniciarOperacion(id, async c => {
    const d = c.datos, vista = id.split('/')[1];
    const turnos = d.real ? d.catalogos.turnos.items.map(t => ({ valor: t.id, texto: t.nombre })) : turnosDemo;
    const puede = c.puedeAccionar;
    if (vista === 'registrar-produccion') {
      if (!d.ordenes.length || !turnos.length) {
        c.vista.innerHTML = tarjeta('Registrar producción', 'Se requiere una orden de producción y al menos un turno activo en PostgreSQL.');
        return;
      }
      c.vista.innerHTML = `${tarjeta('Nueva unidad ensamblada', formulario('form-produccion',
        campo({ id: 'rp-orden', etiqueta: 'Orden de producción', opciones: opcionesOrden(d), requerido: true }) +
        campo({ id: 'rp-turno', etiqueta: 'Turno', opciones: turnos }) +
        campo({ id: 'rp-lote', etiqueta: 'Lote', requerido: true, placeholder: 'Ej. L-2026-01' }) +
        campo({ id: 'rp-serie', etiqueta: 'N.º de serie', requerido: true, placeholder: 'Escanea o escribe una serie única' }) +
        '<div id="datos-orden" class="text-sm text-suave"></div>',
        puede ? boton('Registrar unidad', { enviar: true, id: 'btn-guardar-prod' }) : 'Solo consulta'))}
        ${tarjeta('Unidades registradas', tabla({ filas: d.unidades.filter(u => u.nueva).reverse(), columnas: columnasUnidad }))}`;
      const datosOrden = () => { const o = d.ordenes.find(o => o.id === valor('rp-orden')); document.getElementById('datos-orden').textContent = `Línea: ${o.linea} · Modelo: ${o.modelo} · Color: ${o.color} · Cliente: ${o.cliente}`; };
      datosOrden(); c.evento('#rp-orden', 'change', datosOrden);
      if (puede) c.evento('#form-produccion', 'submit', () => c.escribir('registrarUnidad', { orden: valor('rp-orden'), turno: valor('rp-turno'), lote: valor('rp-lote'), serie: valor('rp-serie') }, 'Unidad registrada. Ya está disponible en Prueba funcional.'));
      return;
    }
    if (vista === 'registrar-incidencia') {
      const campos = campo({ id: 'inc-linea', etiqueta: 'Línea', opciones: d.catalogos.lineas.items.map(l => l.codigo) }) +
        campo({ id: 'inc-tipo', etiqueta: 'Tipo', opciones: ['Material', 'Equipo', 'Calidad', 'Otro'] }) +
        campo({ id: 'inc-sev', etiqueta: 'Severidad', opciones: ['Baja', 'Media', 'Alta'] }) +
        campo({ id: 'inc-paro', etiqueta: 'Minutos de paro', tipo: 'number', valor: '0', extra: 'min="0" step="1"' }) +
        campo({ id: 'inc-motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true });
      const cols = [{ titulo: 'Folio', campo: 'id' }, { titulo: 'Fecha', campo: 'fecha' }, { titulo: 'Línea', campo: 'linea' }, { titulo: 'Tipo', campo: 'tipo' }, { titulo: 'Severidad', campo: 'severidad' }, { titulo: 'Paro (min)', campo: 'paro' }, { titulo: 'Motivo', campo: 'motivo' }, { titulo: 'Responsable', campo: 'usuario' }];
      c.vista.innerHTML = `${puede ? tarjeta('Registrar incidencia', formulario('form-incidencia', campos, boton('Registrar incidencia', { id: 'btn-inc', enviar: true }))) : ''}${tarjeta('Incidencias registradas', tabla({ filas: [...d.incidencias].reverse(), columnas: cols }))}`;
      if (puede) c.evento('#form-incidencia', 'submit', () => c.escribir('registrarIncidencia', { linea: valor('inc-linea'), tipo: valor('inc-tipo'), severidad: valor('inc-sev'), paro: valor('inc-paro'), motivo: valor('inc-motivo') }, 'Incidencia registrada.'));
      return;
    }
    if (vista === 'solicitar-ajuste') {
      const campos = campo({ id: 'aj-orden', etiqueta: 'Orden', opciones: opcionesOrden(d) }) + campo({ id: 'aj-turno', etiqueta: 'Turno', opciones: turnos }) +
        campo({ id: 'aj-tipo', etiqueta: 'Solicitud', opciones: ['Corrección de cierre', 'Reapertura de turno'] }) +
        campo({ id: 'aj-ant', etiqueta: 'Conteo actual', extra: 'readonly' }) + campo({ id: 'aj-nvo', etiqueta: 'Conteo corregido', tipo: 'number', extra: 'min="0" step="1"' }) +
        campo({ id: 'aj-motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true });
      c.vista.innerHTML = `${puede ? tarjeta('Solicitar corrección o reapertura', formulario('form-ajuste', campos, boton('Enviar solicitud', { enviar: true, id: 'btn-solicitar-aj' }))) : ''}
        ${tarjeta('Solicitudes y resoluciones', tabla({ filas: d.autorizaciones.filter(a => a.operacion).reverse(), columnas: [
          { titulo: 'Folio', campo: 'id' }, { titulo: 'Orden', campo: 'orden' }, { titulo: 'Tipo', campo: 'tipo' }, { titulo: 'Cambio', texto: a => a.cambio ? `${a.cambio.de} → ${a.cambio.a}` : 'Reapertura' },
          { titulo: 'Motivo', campo: 'motivo' }, { titulo: 'Estado', html: a => chip(a.estado, a.estado === 'Aprobada' ? 'exito' : 'aviso') }, { titulo: 'Resolución', campo: 'motivoResolucion' },
        ] }))}`;
      if (puede) {
        const actualizar = () => { document.getElementById('aj-ant').value = suma(d.resumen.filter(r => r.dia === 0 && r.orden === valor('aj-orden') && r.turno === Number(valor('aj-turno'))), 'reportadas'); document.getElementById('aj-nvo').disabled = valor('aj-tipo') === 'Reapertura de turno'; };
        actualizar(); c.evento('#aj-orden,#aj-turno,#aj-tipo', 'change', actualizar);
        c.evento('#form-ajuste', 'submit', () => c.escribir('solicitarAjuste', { orden: valor('aj-orden'), turno: valor('aj-turno'), tipo: valor('aj-tipo'), nuevo: valor('aj-nvo'), motivo: valor('aj-motivo') }, 'Solicitud enviada a Autorizaciones de Gerencia.'));
      }
      return;
    }
    if (vista === 'cierre-de-turno') {
      const campos = campo({ id: 'ct-linea', etiqueta: 'Línea', opciones: d.catalogos.lineas.items.map(l => l.codigo) }) + campo({ id: 'ct-turno', etiqueta: 'Turno', opciones: turnos });
      c.vista.innerHTML = `${tarjeta(`Cierre del ${d.fecha || hoyISO()}`, formulario('form-cierre', campos, puede ? boton('Confirmar cierre de turno', { enviar: true, id: 'btn-cerrar-turno' }) + enlace('pages/produccion/solicitar-ajuste.html', 'Solicitar corrección o reapertura') : 'Solo consulta'))}
        ${tarjeta('Cierres guardados', tabla({ filas: [...d.cierres].reverse(), columnas: [{ titulo: 'Fecha', campo: 'fecha' }, { titulo: 'Línea', campo: 'linea' }, { titulo: 'Turno', campo: 'turno' }, { titulo: 'Estado', campo: 'estado' }, { titulo: 'Nota', campo: 'nota' }, { titulo: 'Responsable', campo: 'usuario' }] }))}`;
      const revisar = () => { const cerrado = d.cierres.some(r => r.fecha === (d.fecha || hoyISO()) && r.linea === valor('ct-linea') && r.turno === Number(valor('ct-turno')) && r.estado === 'Cerrado'); const b = document.getElementById('btn-cerrar-turno'); if (b) { b.disabled = cerrado; b.textContent = cerrado ? 'Turno ya cerrado' : 'Confirmar cierre de turno'; } };
      revisar(); c.evento('#ct-linea,#ct-turno', 'change', revisar);
      if (puede) c.evento('#form-cierre', 'submit', async () => { const p = { linea: valor('ct-linea'), turno: valor('ct-turno') }; const r = await preguntar({ titulo: 'Confirmar cierre de turno', mensaje: 'Se bloqueará el registro de nuevas unidades para esta línea y turno. Gerencia deberá autorizar su reapertura.', motivo: { etiqueta: 'Nota de cierre', requerido: true } }); if (r) await c.escribir('cerrarTurno', { ...p, motivo: r.motivo }, 'Cierre guardado.'); });
      return;
    }
    // Los dos tableros comparten cifras y filtros; el del líder muestra el detalle por línea.
    const filas = d.resumen.filter(r => r.dia === 0 && (!filtros.linea || r.linea === filtros.linea) && (!filtros.turno || r.turno === Number(filtros.turno)));
    const porOrden = d.ordenes.filter(o => !filtros.linea || o.linea === filtros.linea).map(o => ({ ...o, turno: filtros.turno || 'Todos', reportadas: suma(filas.filter(f => f.orden === o.id), 'reportadas'), liberadas: suma(filas.filter(f => f.orden === o.id), 'liberadas'), empacadas: suma(filas.filter(f => f.orden === o.id), 'recibidas') }));
    const cols = [{ titulo: 'Orden', campo: 'id' }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Línea', campo: 'linea' }, { titulo: 'Modelo', campo: 'modelo' }, { titulo: 'Reportadas', campo: 'reportadas' }, { titulo: 'Liberadas', campo: 'liberadas' }, { titulo: 'Empacadas', campo: 'empacadas' }];
    c.vista.innerHTML = `${tarjeta('Filtros del turno', formulario('form-tablero', campo({ id: 'f-linea', etiqueta: 'Línea', valor: filtros.linea, opciones: [{ valor: '', texto: 'Todas' }, ...d.catalogos.lineas.items.map(l => l.codigo)] }) + campo({ id: 'f-turno', etiqueta: 'Turno', valor: filtros.turno, opciones: [{ valor: '', texto: 'Todos' }, ...turnos] }), boton('Filtrar', { enviar: true }) + boton('Exportar CSV', { id: 'exportar' })))}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">${indicador({ titulo: 'Meta', valor: suma(filas, 'meta') })}${indicador({ titulo: 'Reportadas', valor: suma(filas, 'reportadas') })}${indicador({ titulo: 'Liberadas', valor: suma(filas, 'liberadas'), tono: 'exito' })}${indicador({ titulo: 'Empacadas', valor: suma(filas, 'recibidas') })}</div>
      ${tarjeta('Producción por orden', tabla({ filas: porOrden, columnas: cols }))}
      ${c.sesion.permisos['produccion/registrar-produccion'] ? enlace('pages/produccion/registrar-produccion.html', 'Registrar producción') : ''}`;
    c.evento('#form-tablero', 'submit', () => { filtros = { linea: valor('f-linea'), turno: valor('f-turno') }; return c.refrescar(); });
    c.evento('#exportar', 'click', () => exportar('produccion.csv', porOrden, cols));
  });
}
