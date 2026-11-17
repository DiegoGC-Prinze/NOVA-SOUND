// Navegador real contra el proyecto efímero creado por scripts/probar_todo.py.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { probarCalidad } from './calidad-flujo.mjs';
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = new URL(fixture.baseURL);
assert.equal(fixture.entorno, 'pruebas');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname) && base.port && base.port !== '8000');
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-gestion-real-'));
const executable = [process.env.NOVA_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
assert.ok(executable);
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${temporal}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { pantallas: [], pasos: [], peticiones: [], errores: [] };
let ws;
try {
  let port;
  for (let i=0;i<100;i++) { try { port=fs.readFileSync(path.join(temporal,'DevToolsActivePort'),'utf8').split('\n')[0];break; } catch {} await sleep(100); }
  assert.ok(port);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map();
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}
    if(m.method==='Runtime.exceptionThrown')report.errores.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Network.requestWillBeSent'){const u=new URL(m.params.request.url);if(u.pathname.startsWith('/api/'))report.peticiones.push({metodo:m.params.request.method,ruta:u.pathname});}
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},25000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  const go=async route=>{await send('Page.navigate',{url:new URL(route,base).href});await sleep(700);};
  const wait=async expr=>{for(let i=0;i<80;i++){if(await evaluate(expr))return;await sleep(100);}throw Error('No se cumplió: '+expr);};
  const click=s=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Falta '+${JSON.stringify(s)});e.click();})()`);
  const fill=(s,v)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Falta '+${JSON.stringify(s)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const text=()=>evaluate("document.querySelector('#contenido')?.innerText||''");
  const api=(nombre,...args)=>evaluate(`import('/js/api.js').then(a=>a[${JSON.stringify(nombre)}](...${JSON.stringify(args)}))`);
  const paso=t=>{report.pasos.push(t);console.log('OK',t);};
  const login=async(user,password)=>{await go('index.html');await evaluate("import('/js/session.js').then(s=>s.cerrarSesion())");await fill('#modo-login','almacen');await fill('#numEmpleado',user);await fill('#contrasena',password);await click('#entrar');await wait("location.pathname.includes('/pages/')");assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('novasound.sesion')).modo"),'real');};
  await login(fixture.sistemas, fixture.passwordSistemas);
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('novasound.sesion')).usuario.rol"),'Sistemas');
  await go('pages/sistemas/nuevo-o-editar-usuario.html');
  await fill('#nombre','Operador desde Sistemas inicial');await fill('#numEmpleado','qa_sistemas_operador_web');await fill('#rol','Operador');await fill('#contrasena',fixture.passwordGeneral);await click('#guardar');
  await wait("location.pathname.endsWith('/usuarios.html')");
  assert.equal((await api('usuarios','qa_sistemas_operador_web')).length,1);
  await login('qa_sistemas_operador_web',fixture.passwordGeneral);
  assert.equal((await api('consultarOperacion','produccion')).real,true);
  paso('La cuenta Sistemas creada al arrancar inicia sesion y da de alta otro usuario desde el formulario');
  await login(fixture.admin, fixture.passwordAdmin);
  const roles=await api('rolesPermisos');
  assert.ok(['calidad','prueba-funcional'].every(area=>roles.pantallas.some(p=>p.area===area)));
  for(const p of roles.pantallas.filter(p=>['produccion','gerencia','sistemas'].includes(p.area) && p.id!=='sistemas/ver-ticket')){
    await go(`pages/${p.id}.html`);
    const contenido=await text();
    assert.doesNotMatch(contenido,/No se pudo|No fue posible|No tienes permiso|undefined|NaN/);
    report.pantallas.push(p.id);
  }
  paso(`${report.pantallas.length} pantallas de Producción, Gerencia y Sistemas consultan datos reales`);
  // Crear el operador desde el formulario de Sistemas y comprobar que puede iniciar sesión.
  await go('pages/sistemas/nuevo-o-editar-usuario.html');
  await fill('#nombre','Operador QA Web');await fill('#numEmpleado','qa_produccion_web');await fill('#rol','Operador');await fill('#contrasena',fixture.passwordGeneral);await click('#guardar');
  await wait("location.pathname.endsWith('/usuarios.html')");
  for(const [numero,rol] of [['qa_lider_web','Líder de línea'],['qa_gerente_web','Gerente de Producción']]){
    await api('guardarUsuario',{numEmpleado:numero,nombre:numero,rol,estado:'Activo',contrasena:fixture.passwordGeneral},true);
  }
  const listado=await api('usuarios','qa_produccion_web');assert.equal(listado.length,1);assert.ok(!('contrasena' in listado[0]));
  paso('Sistemas crea usuarios persistentes con roles reales');
  const planta=roles.roles.find(r=>r.nombre==='Gerente de Planta');
  const permisosPlanta={...planta.permisos};delete permisosPlanta['gerencia/autorizaciones'];
  await api('guardarRol',planta.nombre,{permisos:permisosPlanta,acciones:planta.acciones});
  assert.ok(!('gerencia/autorizaciones' in (await api('rolesPermisos')).roles.find(r=>r.nombre===planta.nombre).permisos));
  paso('Los permisos de un rol se guardan en el servidor');
  // Catálogo y parámetro se vuelven a consultar después de guardarlos.
  await api('guardarElementoCatalogo','defectos',{codigo:'QA-DEF',nombre:'Defecto QA',estado:'Activo'});
  await api('cambiarEstadoCatalogo','defectos','QA-DEF','Inactivo');
  assert.equal((await api('catalogos')).defectos.items.find(i=>i.codigo==='QA-DEF').estado,'Inactivo');
  const param=await api('parametros');
  await api('guardarParametros',{capacidadCaja:{...param.capacidadCaja,'NS-MINI':11},motivo:'Validación del sistema real'});
  assert.equal((await api('parametros')).capacidadCaja['NS-MINI'],11);
  await api('guardarParametros',{capacidadCaja:param.capacidadCaja,motivo:'Restaurar capacidad tras QA'});
  paso('Catálogos y parámetros se guardan y recuperan en PostgreSQL');
  // Ticket público y atención desde Sistemas.
  await go('pages/login/levantar-ticket.html?modo=real');await fill('#numEmpleado','qa_produccion_web');await fill('#nombre','Operador QA Web');await click('#enviar');await wait("document.querySelector('#contenido').innerText.includes('Ticket enviado')");
  const tickets=await api('tickets');const t=tickets.find(t=>t.numEmpleado==='qa_produccion_web');assert.ok(t);
  await go('pages/sistemas/ver-ticket.html?id='+t.id);assert.match(await text(),/Operador QA Web/);report.pantallas.push('sistemas/ver-ticket');
  await api('cerrarTicket',t.id,{comentarios:'Cuenta verificada por Sistemas'});assert.equal((await api('ticket',t.id)).estado,'Cerrado');
  paso('Ticket público llega a Sistemas y su cierre persiste');
  await login('qa_produccion_web',fixture.passwordGeneral);
  await go('pages/produccion/registrar-produccion.html');await fill('#rp-orden',String(fixture.orden));await fill('#rp-turno','1');await fill('#rp-lote','QA-PROD-WEB');await fill('#rp-serie','QA-PROD-WEB-001');await click('#btn-guardar-prod');
  await wait("document.querySelector('#vista-operacion').innerText.includes('QA-PROD-WEB-001')");
  await go('pages/produccion/registrar-produccion.html');assert.match(await text(),/QA-PROD-WEB-001/);
  let d=await api('consultarOperacion','produccion');const orden=d.ordenes.find(o=>o.id===String(fixture.orden));const linea=orden.linea;
  assert.equal(d.unidades.find(u=>u.serie==='QA-PROD-WEB-001').estado,'ENSAMBLADA');
  await go('pages/produccion/registrar-incidencia.html');await fill('#inc-linea',linea);await fill('#inc-paro','7');await fill('#inc-motivo','Paro QA real');await click('#btn-inc');await wait("document.querySelector('#vista-operacion').innerText.includes('Paro QA real')");
  paso('Producción registra unidad e incidencia reales sin liberar por Calidad');
  await login('qa_lider_web',fixture.passwordGeneral);
  await go('pages/produccion/cierre-de-turno.html');await fill('#ct-linea',linea);await fill('#ct-turno','1');await click('#btn-cerrar-turno');await fill('#dialogo-motivo','Cierre real validado por líder');await click('dialog button[type=submit]');await wait("document.querySelector('#btn-cerrar-turno')?.innerText.includes('ya cerrado')");
  await login('qa_produccion_web',fixture.passwordGeneral);
  let bloqueada=await evaluate(`import('/js/api.js').then(a=>a.operar('registrarUnidad',{orden:${JSON.stringify(String(fixture.orden))},turno:1,lote:'QA-PROD-WEB',serie:'QA-PROD-WEB-BLOCK'},'produccion')).then(()=>false,e=>e.estado===409)`);assert.equal(bloqueada,true);
  await login('qa_lider_web',fixture.passwordGeneral);
  await go('pages/produccion/solicitar-ajuste.html');await fill('#aj-orden',String(fixture.orden));await fill('#aj-turno','1');await fill('#aj-tipo','Reapertura de turno');await fill('#aj-motivo','Reapertura para continuar registro QA');await click('#btn-solicitar-aj');await wait("document.querySelector('#vista-operacion').innerText.includes('Pendiente')");
  paso('El cierre bloquea nuevas capturas y el líder solicita reapertura');
  await login('qa_gerente_web',fixture.passwordGeneral);
  await go('pages/gerencia/autorizaciones.html');await click('[data-aprobar]');await click('dialog button[type=submit]');await wait("document.querySelector('#resultado').innerText.includes('Aprobada')");
  await go('pages/gerencia/trazabilidad.html?serie=QA-PROD-WEB-001');await wait("document.querySelector('#resultado').innerText.includes('ENSAMBLADA')");assert.match(await text(),/Operador QA Web/);
  await login('qa_produccion_web',fixture.passwordGeneral);
  await api('operar','registrarUnidad',{orden:String(fixture.orden),turno:1,lote:'QA-PROD-WEB',serie:'QA-PROD-WEB-002'},'produccion');
  assert.ok((await api('consultarOperacion','produccion')).unidades.some(u=>u.serie==='QA-PROD-WEB-002'));
  paso('Gerencia autoriza con otra cuenta; vuelve la captura y existe trazabilidad real');
  await probarCalidad({fixture,api,go,login,wait,click,fill,text,evaluate,paso,report});
  assert.equal(await evaluate("localStorage.getItem('novasound.mock.operacion')"),null);
  assert.deepEqual(report.errores,[]);
  paso('Flujo completo usa API sin guardar operaciones en la demo');
}catch(e){report.fallo=e.stack;console.error(e.stack);process.exitCode=1;}
finally{fs.writeFileSync(path.join(temporal,'resultado.json'),JSON.stringify(report,null,2));ws?.close();browser.kill();console.log('Evidencia:',temporal);}
