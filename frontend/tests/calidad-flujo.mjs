import assert from 'node:assert/strict';

// Se ejecuta dentro del navegador y proyecto temporal de gestion-real.test.mjs.
export async function probarCalidad({fixture,api,go,login,wait,click,fill,text,evaluate,paso,report}) {
  const serie = 'QA-FULL-WEB-001';
  await login(fixture.admin,fixture.passwordAdmin);
  await api('guardarUsuario',{numEmpleado:'qa_inspector_web',nombre:'Inspector QA Web',rol:'Inspector de Calidad',estado:'Activo',contrasena:fixture.passwordGeneral},true);
  const roles = await api('rolesPermisos');
  const inspector = roles.roles.find(r=>r.nombre==='Inspector de Calidad');
  const permisosInspector = {...inspector.permisos};delete permisosInspector['calidad/reportes-de-calidad'];
  await api('guardarRol',inspector.nombre,{permisos:permisosInspector,acciones:inspector.acciones});
  const pantallas = roles.pantallas.filter(p=>['calidad','prueba-funcional'].includes(p.area));
  assert.equal(pantallas.length,10);
  for (const p of pantallas) {
    await go(`pages/${p.id}.html`);
    assert.doesNotMatch(await text(),/No se pudo|No fue posible|No tienes permiso|undefined|NaN/);
    report.pantallas.push(p.id);
  }
  paso('Las 10 pantallas nuevas de Pruebas y Calidad consultan PostgreSQL');
  await login('qa_produccion_web',fixture.passwordGeneral);
  await api('operar','registrarUnidad',{orden:String(fixture.orden),turno:1,lote:'QA-FULL-WEB',serie},'produccion');
  await go('pages/prueba-funcional/escanear-pieza-o-lote.html');
  await fill('#pf-buscar',serie);await click('#form-buscar button[type=submit]');
  await wait(`document.querySelector('#vista-operacion').innerText.includes(${JSON.stringify(serie)})`);
  const paginaPrueba = 'pages/prueba-funcional/registro-de-pruebas-funcionales.html?unidad='+serie;
  await go(paginaPrueba);await wait("!!document.querySelector('#form-prueba')");
  for (const key of ['encendido','audio','carga','bluetooth']) await click(`[name="prueba-${key}"][value="${key==='audio'?'Falla':'Aprobada'}"]`);
  await fill('#obs-operador','Falla de audio detectada y documentada');await click('#btn-guardar');
  await wait(`import('/js/api.js').then(a=>a.consultarOperacion('prueba-funcional')).then(d=>d.unidades.find(u=>u.serie===${JSON.stringify(serie)})?.estado==='FALLA_FUNCIONAL')`);
  await go(paginaPrueba);
  for (const key of ['encendido','audio','carga','bluetooth']) await click(`[name="prueba-${key}"][value="Aprobada"]`);
  await click('#btn-guardar');await wait("!document.querySelector('#form-prueba')");
  paso('Prueba funcional: falla, repetición aprobada e historial real');
  await login('qa_inspector_web',fixture.passwordGeneral);
  await go('pages/calidad/resumen-de-calidad.html');await wait(`document.querySelector('#contenido').innerText.includes(${JSON.stringify(serie)})`);
  await go('pages/calidad/inspeccion-de-unidad.html?serie='+serie);await wait("!!document.querySelector('#form-inspeccion')");
  const cat = await api('catalogos','calidad');
  const categoria = cat.categorias.items.find(c=>cat.defectos.items.some(d=>d.estado==='Activo'&&d.codigo.startsWith(c.codigo+'-')));
  const defecto = cat.defectos.items.find(d=>d.estado==='Activo'&&d.codigo.startsWith(categoria.codigo+'-'));
  await fill('#categoria',categoria.nombre);await fill('#defecto',defecto.nombre);await fill('#causa','Hallazgo QA en inspección');await click('#agregar-defecto');
  await click('[name=disposicion][value=EN_RETENCION]');await fill('#observaciones','Pendiente de revisión QA');await click('#guardar');
  await wait("!document.querySelector('#form-inspeccion')");
  await go('pages/calidad/retenciones.html');await wait(`!!document.querySelector('[data-revisar="${serie}"]')`);await click(`[data-revisar="${serie}"]`);
  await click('dialog [name=disposicion][value=RETRABAJO]');await fill('dialog #observaciones','Corregir el defecto antes de liberar');await click('dialog #guardar');await wait("!document.querySelector('dialog')");
  await go('pages/calidad/retrabajos.html');await wait(`!!document.querySelector('[data-revisar="${serie}"]')`);await click(`[data-revisar="${serie}"]`);
  await fill('dialog #descripcion','Se corrigió el defecto y se revisó la unidad');await click('dialog [name=resultado][value=Corregido]');await click('dialog #guardar');await wait("!document.querySelector('dialog')");
  await go('pages/calidad/inspeccion-de-unidad.html?serie='+serie);await wait("!!document.querySelector('#form-inspeccion')");
  await click('[name=disposicion][value=LIBERADA]');await click('#guardar');await wait("!document.querySelector('#form-inspeccion')");
  assert.equal((await api('unidadPorSerie',serie)).estado,'LIBERADA');
  paso('Calidad: inspección, retención, retrabajo, reinspección y liberación persistidos');
  await login(fixture.usuario,fixture.password);
  await go('pages/empaque/formar-caja.html');await fill('#orden',String(fixture.orden));await click('#nueva-caja');await wait("!!document.querySelector('#caja-activa table')");
  const caja=await evaluate("new URLSearchParams(location.search).get('caja')");
  await fill('#buscar',serie);await click('#form-agregar button[type=submit]');await wait(`document.querySelector('#en-caja')?.innerText.includes(${JSON.stringify(serie)})`);
  await click('#cerrar');await fill('#dialogo-motivo','Pedido parcial del flujo completo QA');await click('dialog button[type=submit]');await wait("document.querySelector('#caja-activa')?.innerText.includes('Cerrada')");
  await go('pages/embarques/armar-embarque.html');await fill('#emb-orden',String(fixture.orden));await fill('#emb-destino','Destino flujo completo QA');await fill('#emb-contenedor','CONT-QA-FULL');await click('#crear-embarque');await wait("!!document.querySelector('#embarque-activo table')");
  await click(`[data-accion=asignar][data-caja="${caja}"]`);await wait("!!document.querySelector('[data-accion=retirar]')");
  await click('#btn-confirmar-emb');await click('dialog button[type=submit]');await wait("document.querySelector('#embarque-activo')?.innerText.includes('Enviado')");
  paso('La unidad liberada pasa por Empaque y sale en un embarque real');
  await login('qa_gerente_web',fixture.passwordGeneral);
  await go('pages/gerencia/trazabilidad.html?serie='+serie);await wait("document.querySelector('#resultado').innerText.includes('EMBARCADA')");
  const traza = await api('unidadPorSerie',serie,'gerencia');
  for (const area of ['Producción','Prueba funcional','Calidad','Empaque','Embarques']) assert.ok(traza.historial.some(e=>e.area===area),area);
  assert.ok(traza.historial.some(e=>e.area==='Prueba funcional'&&e.usuario==='Operador QA Web'));
  assert.ok(traza.historial.some(e=>e.area==='Calidad'&&e.usuario==='Inspector QA Web'));
  assert.equal(traza.estado,'EMBARCADA');
  paso('Gerencia muestra la trazabilidad completa y las identidades reales');
}
