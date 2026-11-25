import { iniciarOperacion, campo, boton, tabla, tarjeta, formulario, valor, enlace, exportar, esc, chipUnidad, aviso } from './operacion-comun.js';
import { indicador, preguntar, barra } from '../componentes.js';
import { fechaCorta } from '../ui.js';

const accion = (nombre, texto, atributos = '') => boton(texto, { tipo: 'secundario', extra: `data-accion="${nombre}" ${atributos}` });
const opcionesOrden = d => d.ordenes.map(o => ({ valor: o.id, texto: `${o.id} · ${o.modelo} · ${o.cliente}` }));
const colsCaja = [
  { titulo: 'Caja', campo: 'id' }, { titulo: 'Orden', campo: 'orden' }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Modelo', campo: 'modelo' },
  { titulo: 'Estado', campo: 'estado' }, { titulo: 'Unidades', texto: c => c.cantidad ?? c.unidades.length }, { titulo: 'Capacidad', campo: 'capacidad' }, { titulo: 'Embarque', campo: 'embarque' },
];
const colsEmbarque = [{ titulo: 'Embarque', campo: 'id' }, { titulo: 'Orden', campo: 'orden' }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Destino', campo: 'destino' }, { titulo: 'Contenedor', campo: 'contenedor' }, { titulo: 'Estado', campo: 'estado' }, { titulo: 'Cajas', texto: e => e.cantidadCajas ?? e.cajas.length }, { titulo: 'Salida', campo: 'fechaSalida' }];
const historial = r => tabla({ filas: [...(r.auditoria || [])].reverse(), columnas: [{ titulo: 'Fecha', campo: 'fecha' }, { titulo: 'Hora', campo: 'hora' }, { titulo: 'Responsable', campo: 'quien' }, { titulo: 'Evento', campo: 'que' }, { titulo: 'Motivo', campo: 'motivo' }] });

function graficasPorEstado(embarques) {
  const grupos = [
    { nombre: 'Entregados', color: '#2E7D32', tono: 'exito', estados: ['ENTREGADO', 'ENTREGADOS'] },
    { nombre: 'Devueltos', color: '#C62828', tono: 'peligro', estados: ['DEVUELTO', 'DEVUELTOS'] },
    { nombre: 'Pendientes', color: '#C28A00', estados: ['PENDIENTE', 'PENDIENTES'] },
    { nombre: 'En proceso', color: '#0E6B52', estados: ['EN PROCESO', 'EN_PROCESO', 'PREPARANDO', 'PREPARACION', 'PREPARACIÓN'] },
  ].map(grupo => ({
    ...grupo,
    cantidad: embarques.filter(e => grupo.estados.includes(String(e.estado ?? '').trim().toUpperCase())).length,
  }));
  const pasteles = grupos.map(({ nombre, cantidad, color }) => {
    const porcentaje = embarques.length ? cantidad / embarques.length * 100 : 0;
    return `
      <figure class="flex flex-col items-center gap-3 text-center">
        <figcaption class="font-semibold">${nombre}</figcaption>
        <div aria-hidden="true" class="size-28 rounded-full" style="background: conic-gradient(${color} ${porcentaje}%, #E6EBEF 0)"></div>
        <p class="text-sm"><strong>${cantidad}</strong> de ${embarques.length} embarques · ${porcentaje.toFixed(1)} %</p>
      </figure>`;
  }).join('');
  const comparados = grupos.slice(0, 2);
  const maximo = Math.max(1, ...comparados.map(g => g.cantidad));
  const barras = comparados.map(({ nombre, cantidad, tono }) => `
    <li>
      <div class="mb-1 flex justify-between gap-2 text-sm"><span>${nombre}</span><strong>${cantidad}</strong></div>
      ${barra(cantidad / maximo * 100, tono)}
    </li>`).join('');
  return tarjeta('Embarques por estado', `
    <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">${pasteles}</div>
    <p class="mt-4 text-sm text-suave">Cada pastel compara su estado con el total filtrado. Un embarque enviado cuenta como entregado cuando tiene registrado el estado Entregado.</p>
  `) + tarjeta('Entregados y devueltos', `<ul class="space-y-4">${barras}</ul>`);
}

export function iniciarAlmacen(id) {
  const params = new URLSearchParams(location.search);
  let cajaId = params.get('caja') || '';
  let embarqueId = params.get('embarque') || '';
  let busqueda = id.endsWith('/rastreo-de-contenedor') ? params.get('buscar') || '' : '';
  let filtro = { desde: '', hasta: '', estado: '', modelo: '' };
  iniciarOperacion(id, async c => {
    const d = c.datos, vista = id.split('/')[1];
    const editaCaja = c.permite('empaque/formar-caja', 'cerrar-caja');
    const editaEmbarque = c.permite('embarques/armar-embarque', 'confirmar-salida-de-embarque');
    const setCaja = r => { cajaId = r.id; history.replaceState(null, '', `?caja=${encodeURIComponent(r.id)}`); };
    const setEmbarque = r => { embarqueId = r.id; history.replaceState(null, '', `?embarque=${encodeURIComponent(r.id)}`); };
    const tablaCajas = (filas, acciones) => tabla({ filas, columnas: [...colsCaja, ...(acciones ? [{ titulo: 'Acciones', html: acciones }] : [])] });
    const verCaja = b => enlace(`pages/empaque/consultar-caja.html?caja=${encodeURIComponent(b.id)}`, 'Consultar');
    const cerrar = async b => {
      const capacidad = Number(b.capacidad ?? d.parametros.capacidadCaja[b.modelo]);
      const cantidad = b.cantidad ?? b.unidades.length;
      const r = await preguntar({ titulo: `Cerrar ${b.id}`, mensaje: `${cantidad} de ${capacidad} unidades. Confirma que revisaste el contenido y la orden.${d.real && cantidad < capacidad ? ' El motivo de caja incompleta debe tener al menos 10 caracteres.' : ''}`, motivo: { etiqueta: cantidad < capacidad ? 'Motivo de caja incompleta' : 'Nota de cierre', requerido: cantidad < capacidad }, textoOk: 'Confirmar cierre', tipoOk: 'confirmar' });
      if (r) await c.escribir('cerrarCaja', { caja: b.id, motivo: r.motivo, validado: true }, 'Caja cerrada. Ya puede asignarse a un embarque.');
    };
    const conectarCierre = () => c.evento('[data-accion="cerrar"]', 'click', (_e, el) => cerrar(d.cajas.find(b => b.id === el.dataset.caja)));
    const renderCaja = b => {
      const filas = b.unidades.map(s => d.unidades.find(u => u.serie === s)).filter(Boolean);
      return tarjeta(`Caja ${b.id}`, tablaCajas([b])) + tarjeta('Contenido de la caja', tabla({ filas, columnas: [{ titulo: 'Serie', campo: 'serie' }, { titulo: 'Color', campo: 'color' }, { titulo: 'Estado', html: u => chipUnidad(u.estado) }] })) + tarjeta('Historial de la caja', historial(b));
    };
    if (vista === 'formar-caja') {
      const b = d.cajas.find(b => b.id === cajaId);
      c.vista.innerHTML = `${editaCaja ? tarjeta('Crear caja para una orden', formulario('form-nueva-caja', campo({ id: 'orden', etiqueta: 'Orden', opciones: opcionesOrden(d) }), boton('Crear caja', { enviar: true, id: 'nueva-caja' }))) : aviso('info', 'Tu rol solo puede consultar esta pantalla.')}
        ${tarjeta('Cajas abiertas', tabla({ filas: d.cajas.filter(b => b.estado === 'Abierta'), columnas: [
          { titulo: 'Caja', html: r => enlace(`pages/empaque/formar-caja.html?caja=${encodeURIComponent(r.id)}`, r.id) }, ...colsCaja.slice(1),
        ] }))}<div id="caja-activa" class="space-y-4"></div>`;
      if (editaCaja) c.evento('#form-nueva-caja', 'submit', () => c.escribir('crearCaja', { orden: valor('orden') }, 'Caja creada.', setCaja));
      if (!b) return;
      const disponibles = d.unidades.filter(u => u.orden === b.orden && u.modelo === b.modelo && (b.mezclaColores || u.color === b.color) && u.estado === 'LIBERADA' && !u.caja);
      const contenido = b.unidades.map(s => d.unidades.find(u => u.serie === s)).filter(Boolean);
      const abierta = b.estado === 'Abierta' && !b.embarque;
      document.getElementById('caja-activa').innerHTML = `${tarjeta(`Caja activa ${b.id}`, tablaCajas([{ ...b, capacidad: abierta ? d.parametros.capacidadCaja[b.modelo] : b.capacidad }]))}
        ${tarjeta('Agregar por número de serie', editaCaja && abierta ? formulario('form-agregar', campo({ id: 'buscar', etiqueta: 'Serie', placeholder: 'Escanea la unidad liberada', requerido: true }), boton('Agregar unidad', { enviar: true })) : aviso('info', 'La caja está cerrada o asignada y no admite cambios.'))}
        ${tarjeta('Unidades disponibles para esta orden', tabla({ filas: disponibles, columnas: [{ titulo: 'Serie', campo: 'serie' }, { titulo: 'Modelo', campo: 'modelo' }, { titulo: 'Color', campo: 'color' }, { titulo: 'Acción', html: u => editaCaja && abierta ? accion('agregar', 'Agregar', `data-serie="${esc(u.serie)}"`) : '' }] }))}
        ${tarjeta('Contenido de la caja', `<div id="en-caja">${tabla({ filas: contenido, columnas: [{ titulo: 'Serie', campo: 'serie' }, { titulo: 'Estado', html: u => chipUnidad(u.estado) }, { titulo: 'Acción', html: u => editaCaja && abierta ? accion('quitar', 'Quitar', `data-serie="${esc(u.serie)}"`) : '' }] })}</div>`, { acciones: editaCaja && abierta ? boton('Cerrar caja', { id: 'cerrar' }) : verCaja(b) })}`;
      if (editaCaja && abierta) {
        c.evento('[data-accion="agregar"]', 'click', (_e, el) => c.escribir('agregarUnidad', { caja: b.id, serie: el.dataset.serie }, 'Unidad agregada.'));
        c.evento('#form-agregar', 'submit', () => c.escribir('agregarUnidad', { caja: b.id, serie: valor('buscar') }, 'Unidad agregada.'));
        c.evento('[data-accion="quitar"]', 'click', (_e, el) => c.escribir('quitarUnidad', { caja: b.id, serie: el.dataset.serie }, 'Unidad retirada.'));
        c.evento('#cerrar', 'click', () => cerrar(b));
      }
      return;
    }
    if (vista === 'consultar-caja') {
      const b = d.cajas.find(b => b.id === cajaId);
      const puedeReabrir = c.permite('empaque/consultar-caja', 'reabrir-caja');
      c.vista.innerHTML = tarjeta('Buscar caja', formulario('form-buscar', campo({ id: 'id-caja', etiqueta: 'Id de la caja', valor: cajaId, requerido: true }), boton('Buscar', { enviar: true }))) + `<div id="resultado" class="space-y-4">${b ? renderCaja(b) : aviso('info', cajaId ? 'No se encontró ninguna caja con ese identificador.' : 'Escribe o escanea el identificador de una caja creada en Empaque.')}</div>`;
      if (b) {
        if (puedeReabrir && !d.real && b.estado === 'Cerrada' && !b.embarque) c.vista.insertAdjacentHTML('beforeend', boton('Reabrir caja', { id: 'reabrir' }));
        if (d.real && b.estado === 'Cerrada' && !b.embarque) {
          const puedeSolicitar = c.puede('cerrar-caja') || c.puede('reabrir-caja');
          if (puedeSolicitar) c.vista.insertAdjacentHTML('beforeend', boton('Solicitar reapertura', { id: 'solicitar-reapertura' }));
          c.vista.insertAdjacentHTML('beforeend', tarjeta('Solicitudes de reapertura', tabla({ filas: d.solicitudes, columnas: [
            { titulo: 'Solicitud', campo: 'id_autorizacion' }, { titulo: 'Solicitante', campo: 'id_usuario_solicita' }, { titulo: 'Motivo', campo: 'motivo' }, { titulo: 'Estado', campo: 'estado' },
            { titulo: 'Acción', html: s => puedeReabrir && s.estado === 'PENDIENTE' && s.id_usuario_solicita !== c.sesion.usuario.id ? boton('Autorizar reapertura', { extra: `data-autorizar-reapertura="${s.id_autorizacion}"` }) : '' },
          ] })));
        }
      }
      c.evento('#form-buscar', 'submit', () => { cajaId = valor('id-caja').toUpperCase(); history.replaceState(null, '', `?caja=${encodeURIComponent(cajaId)}`); return c.refrescar(); });
      conectarCierre();
      c.evento('#reabrir', 'click', async () => { const r = await preguntar({ titulo: 'Reabrir caja', motivo: { etiqueta: 'Motivo de reapertura', requerido: true } }); if (r) await c.escribir('reabrirCaja', { caja: b.id, motivo: r.motivo }, 'Caja reabierta.'); });
      c.evento('#solicitar-reapertura', 'click', async () => {
        const r = await preguntar({ titulo: 'Solicitar reapertura', mensaje: 'Otra persona con permiso de supervisor debe autorizarla. Escribe un motivo de al menos 10 caracteres.', motivo: { etiqueta: 'Motivo', requerido: true } });
        if (r) await c.escribir('solicitarReapertura', { caja: b.id, motivo: r.motivo }, 'Solicitud guardada. La caja permanece cerrada hasta la autorización.');
      });
      c.evento('[data-autorizar-reapertura]', 'click', async (_ev, el) => {
        const r = await preguntar({ titulo: 'Autorizar reapertura', mensaje: 'Quedará registrada tu autorización y la caja volverá a estar abierta.' });
        if (r) await c.escribir('reabrirCaja', { caja: b.id, autorizacion: el.dataset.autorizarReapertura }, 'Reapertura autorizada y guardada.');
      }); return;
    }
    if (vista === 'confirmar-cierre-de-caja') {
      c.vista.innerHTML = tarjeta('Cajas pendientes de cierre', tablaCajas(d.cajas.filter(b => b.estado === 'Abierta'), b => verCaja(b) + (c.puedeAccionar && c.puede('cerrar-caja') ? accion('cerrar', 'Cerrar caja', `data-caja="${esc(b.id)}"`) : '')));
      conectarCierre(); return;
    }
    if (vista === 'armar-embarque') {
      const e = d.embarques.find(e => e.id === embarqueId);
      c.vista.innerHTML = `${editaEmbarque ? tarjeta('Nuevo embarque', formulario('form-embarque', campo({ id: 'emb-orden', etiqueta: 'Orden', opciones: opcionesOrden(d) }) + campo({ id: 'emb-destino', etiqueta: 'Destino', requerido: true }) + campo({ id: 'emb-contenedor', etiqueta: 'Contenedor / referencia de transporte' }), boton('Crear embarque', { enviar: true, id: 'crear-embarque' }))) : ''}
        ${tarjeta('Embarques registrados', tabla({ filas: d.embarques, columnas: [...colsEmbarque, { titulo: 'Acción', html: e => enlace(`pages/embarques/armar-embarque.html?embarque=${encodeURIComponent(e.id)}`, 'Ver embarque') }] }))}<div id="embarque-activo" class="space-y-4"></div>`;
      if (editaEmbarque) c.evento('#form-embarque', 'submit', () => c.escribir('crearEmbarque', { orden: valor('emb-orden'), destino: valor('emb-destino'), contenedor: valor('emb-contenedor') }, 'Embarque creado.', setEmbarque));
      if (!e) return;
      const preparando = e.estado === 'Preparando';
      const libres = d.cajas.filter(b => b.orden === e.orden && b.estado === 'Cerrada' && !b.embarque);
      const asignadas = d.cajas.filter(b => e.cajas.includes(b.id));
      document.getElementById('embarque-activo').innerHTML = `${tarjeta(`Embarque ${e.id}`, tabla({ filas: [e], columnas: colsEmbarque }))}
        ${tarjeta('Cajas cerradas disponibles', tablaCajas(libres, b => editaEmbarque && preparando ? accion('asignar', 'Asignar caja', `data-caja="${esc(b.id)}"`) : ''))}
        ${tarjeta('Cajas del embarque', tablaCajas(asignadas, editaEmbarque && preparando ? b => accion('retirar', 'Retirar', `data-caja="${esc(b.id)}"`) : null), { acciones: editaEmbarque && preparando ? boton('Confirmar salida de embarque', { id: 'btn-confirmar-emb' }) : '' })}${tarjeta('Historial del embarque', historial(e))}`;
      if (editaEmbarque && preparando) {
        c.evento('[data-accion="asignar"]', 'click', (_ev, el) => c.escribir('asignarCaja', { caja: el.dataset.caja, embarque: e.id }, 'Caja asignada.'));
        c.evento('[data-accion="retirar"]', 'click', (_ev, el) => c.escribir('quitarCaja', { caja: el.dataset.caja, embarque: e.id }, 'Caja retirada del embarque.'));
        c.evento('#btn-confirmar-emb', 'click', async () => { const r = await preguntar({ titulo: 'Confirmar salida', mensaje: `Se registrará la salida de ${e.cajas.length} cajas del embarque ${e.id} a ${e.destino}.`, textoOk: 'Confirmar salida', tipoOk: 'confirmar' }); if (r) await c.escribir('confirmarSalida', { embarque: e.id }, 'Salida registrada. La trazabilidad ya muestra el embarque.'); });
      } return;
    }
    if (vista === 'rastreo-de-contenedor') {
      const exacto = d.embarques.find(e => e.id === busqueda);
      const encontradas = exacto ? [exacto] : busqueda
        ? d.embarques.filter(e => e.contenedor?.toUpperCase().includes(busqueda.toUpperCase()))
        : [];
      const rutas = encontradas.map(e => tarjeta(`Embarque ${e.id}`, `
        <ol aria-label="Recorrido del embarque" class="relative grid grid-cols-2 gap-6 text-sm">
          <li class="relative border-t-2 border-marca pt-3 before:absolute before:-top-1.5 before:left-0 before:size-2.5 before:rounded-full before:bg-marca">
            <strong>Partida</strong><p>${e.fechaSalida ? fechaCorta(e.fechaSalida) : 'Salida pendiente'}</p>
          </li>
          <li class="relative border-t-2 border-borde pt-3 text-right before:absolute before:-top-1.5 before:right-0 before:size-2.5 before:rounded-full before:border-2 before:border-marca before:bg-white">
            <strong>Destino</strong><p>${esc(e.destino || 'Sin destino registrado')}</p>
          </li>
        </ol>`)).join('');
      c.vista.innerHTML = tarjeta('Rastrear contenedor o embarque', formulario('form-rastreo',
        campo({ id: 'busqueda-contenedor', etiqueta: 'Contenedor o embarque', valor: busqueda, requerido: true }),
        boton('Buscar', { enviar: true }))) + (rutas || aviso('info', busqueda ? 'No se encontró ese contenedor o embarque.' : 'Busca una referencia registrada al crear el embarque.'));
      c.evento('#form-rastreo', 'submit', () => { busqueda = valor('busqueda-contenedor'); return c.refrescar(); });
      return;
    }
    if (vista === 'inicio-de-empaque-panel-de-control') {
      const abiertas = d.cajas.filter(b => b.estado === 'Abierta');
      const cerradas = d.panel?.cajas_cerradas ?? d.cajas.filter(b => b.estado === 'Cerrada').length;
      const pendientes = d.panel?.unidades_pendientes ?? d.unidades.filter(u => u.estado === 'LIBERADA' && !u.caja).length;
      const columnas = [
        { titulo: 'Caja', campo: 'id' }, { titulo: 'Cliente', campo: 'cliente' }, { titulo: 'Modelo', campo: 'modelo' },
        { titulo: 'Progreso', texto: b => `${b.cantidad ?? b.unidades.length} / ${b.capacidad}` },
        { titulo: 'Estado', campo: 'estado' }, { titulo: 'Acción', html: verCaja },
      ];
      c.vista.innerHTML = `
        <div class="grid gap-3 sm:grid-cols-3">
          ${indicador({ titulo: 'Cajas cerradas', valor: cerradas, tono: 'exito' })}
          ${indicador({ titulo: 'Cajas en proceso', valor: d.panel?.cajas_en_proceso ?? abiertas.length })}
          ${indicador({ titulo: 'Pendientes de empaque', valor: pendientes, tono: 'aviso' })}
        </div>
        ${tarjeta('Cajas en proceso', tabla({ filas: abiertas, columnas }))}
        <div class="flex flex-wrap gap-2">
          ${editaCaja ? enlace('pages/empaque/formar-caja.html', 'Formar caja') : ''}
          ${c.sesion.permisos['empaque/consultar-caja'] ? enlace('pages/empaque/consultar-caja.html', 'Consultar caja') : ''}
        </div>`;
      return;
    }
    // Paneles, historial, reportes y gráficas consultan los mismos registros.
    const esEmbarque = id.startsWith('embarques/');
    const lista = esEmbarque ? d.embarques : d.cajas;
    const filas = lista.filter(r => (!busqueda || `${r.id} ${r.cliente} ${r.orden} ${r.embarque || ''}`.toLowerCase().includes(busqueda.toLowerCase())) && (!filtro.estado || r.estado === filtro.estado) && (!filtro.modelo || r.modelo === filtro.modelo) && (!filtro.desde || r.fecha >= filtro.desde) && (!filtro.hasta || r.fecha <= filtro.hasta));
    const sonCajas = !esEmbarque;
    const cols = sonCajas
      ? vista === 'historial-de-cajas' ? [...colsCaja, { titulo: 'Fecha', campo: 'fecha' }, { titulo: 'Hora', texto: b => b.hora || b.auditoria?.[0]?.hora || '' }] : colsCaja
      : vista === 'estado-del-embarque'
        ? [{ titulo: 'Embarque', campo: 'id', html: e => c.sesion.permisos['embarques/rastreo-de-contenedor'] ? enlace(`pages/embarques/rastreo-de-contenedor.html?buscar=${encodeURIComponent(e.id)}`, e.id) : esc(e.id) }, ...colsEmbarque.slice(1)]
        : colsEmbarque;
    const campos = campo({ id: 'f-buscar', etiqueta: 'Identificador, orden o cliente', valor: busqueda }) +
      campo({ id: 'f-estado', etiqueta: 'Estado', valor: filtro.estado, opciones: [{ valor: '', texto: 'Todos' }, ...(sonCajas ? ['Abierta', 'Cerrada', 'Embarcada'] : ['Preparando', 'Enviado'])] }) +
      campo({ id: 'f-desde', etiqueta: 'Desde', tipo: 'date', valor: filtro.desde }) + campo({ id: 'f-hasta', etiqueta: 'Hasta', tipo: 'date', valor: filtro.hasta }) +
      (sonCajas ? campo({ id: 'f-modelo', etiqueta: 'Modelo', valor: filtro.modelo, opciones: [{ valor: '', texto: 'Todos' }, ...Object.keys(d.parametros.capacidadCaja)] }) : '');
    c.vista.innerHTML = `${tarjeta('Filtros', formulario('form-filtros', campos, boton('Filtrar', { enviar: true }) + boton('Limpiar', { id: 'limpiar' }) + boton('Exportar CSV', { id: 'exportar' })))}
      <div class="grid gap-3 sm:grid-cols-3">${indicador({ titulo: 'Cajas abiertas', valor: d.cajas.filter(b => b.estado === 'Abierta').length })}${indicador({ titulo: 'Cajas cerradas', valor: d.cajas.filter(b => b.estado === 'Cerrada').length, tono: 'exito' })}${indicador({ titulo: 'Embarques enviados', valor: d.embarques.filter(e => e.estado === 'Enviado').length, tono: 'exito' })}</div>
      ${tarjeta('Registros', tabla({ filas, columnas: sonCajas ? [...cols, { titulo: 'Acción', html: verCaja }] : cols }))}`;
    if (vista === 'historial-de-cajas' && cajaId) { const b = d.cajas.find(b => b.id === cajaId); if (b) c.vista.insertAdjacentHTML('beforeend', tarjeta(`Historial de ${b.id}`, historial(b))); }
    if (vista === 'grafica-de-embarques') {
      c.vista.insertAdjacentHTML('beforeend', graficasPorEstado(filas));
    }
    if (vista === 'grafica-de-embarques' || vista === 'reportes-de-empaque') {
      const grupos = [...new Set(filas.map(f => f.cliente))].map(cliente => ({ cliente, cantidad: filas.filter(f => f.cliente === cliente).length }));
      const max = Math.max(1, ...grupos.map(g => g.cantidad));
      c.vista.insertAdjacentHTML('beforeend', tarjeta('Distribución por cliente', grupos.length ? grupos.map(g => `<div class="mb-4"><p class="mb-1 text-sm">${esc(g.cliente)} · ${g.cantidad}</p>${barra(g.cantidad / max * 100)}</div>`).join('') : aviso('info', 'Los registros aparecerán en la gráfica al crear cajas y embarques.')));
    }
    c.evento('#form-filtros', 'submit', () => { if (valor('f-desde') && valor('f-hasta') && valor('f-desde') > valor('f-hasta')) throw new Error('La fecha inicial no puede ser posterior a la final.'); busqueda = valor('f-buscar'); filtro = { desde: valor('f-desde'), hasta: valor('f-hasta'), estado: valor('f-estado'), modelo: valor('f-modelo') }; return c.refrescar(); });
    c.evento('#limpiar', 'click', () => { busqueda = ''; filtro = { desde: '', hasta: '', estado: '', modelo: '' }; return c.refrescar(); });
    c.evento('#exportar', 'click', () => exportar(`${vista}.csv`, filas, cols));
  }, { contexto: () => ({ caja: cajaId, embarque: embarqueId }) });
}
