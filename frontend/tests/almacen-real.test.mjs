// Solo contra una instalacion aislada: node frontend/tests/almacen-real.test.mjs fixture.json
// El JSON privado contiene baseURL, usuario/password, supervisor/passwordSupervisor,
// orden, serie y serieRetenida. Nunca se imprimen contrasenas ni tokens.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
assert.ok(process.argv[2], 'Indica el archivo privado del entorno de pruebas.');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = new URL(fixture.baseURL);
assert.equal(fixture.entorno, 'pruebas');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.ok(base.port && base.port !== '8000', 'Usa el puerto del entorno aislado, no la app del usuario.');
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-almacen-real-'));
const executable = [process.env.NOVA_TEST_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
assert.ok(executable, 'No se encontro Edge/Chrome.');
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
  const go=async route=>{await send('Page.navigate',{url:new URL(route,base).href});await sleep(800);};
  const wait=async expr=>{for(let i=0;i<80;i++){if(await evaluate(expr))return;await sleep(100);}throw Error('No se cumplio: '+expr);};
  const click=s=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Falta '+${JSON.stringify(s)});e.click();})()`);
  const fill=(s,v)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Falta '+${JSON.stringify(s)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const text=()=>evaluate("document.querySelector('#contenido')?.innerText||''");
  const paso=t=>{report.pasos.push(t);console.log('OK',t);};
  const login=async(user,password)=>{await go('index.html');await fill('#modo-login','almacen');await fill('#numEmpleado',user);await fill('#contrasena',password);await click('#entrar');await wait("location.pathname.includes('/pages/empaque/')");assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('novasound.sesion')).modo"),'real');};
  const salir=async()=>{await click('#salir');await wait("location.pathname==='/index.html'");await sleep(300);};
  await login(fixture.usuario,fixture.password);paso('Login real de Almacen');
  const screens=await evaluate("(await import('/js/menu.js')).PANTALLAS.filter(p=>['empaque','embarques'].includes(p.area))");
  for(const p of screens){await go(p.ruta);await wait("!!document.querySelector('#vista-operacion')");assert.equal(await evaluate("document.querySelector('#error-operacion').innerText"),'',p.id);assert.match(await text(),/Datos de PostgreSQL/);report.pantallas.push(p.id);}
  paso('13 pantallas consultan PostgreSQL con su rol real');
  await go('pages/empaque/formar-caja.html');await fill('#orden',String(fixture.orden));await click('#nueva-caja');await wait("!!document.querySelector('#caja-activa table')");
  const caja=await evaluate("new URLSearchParams(location.search).get('caja')");assert.match(caja,/^\d+$/);report.caja=caja;
  await fill('#buscar',fixture.serieRetenida);await click('#form-agregar button[type=submit]');await wait("!!document.querySelector('#error-operacion')?.innerText");assert.match(await text(),/Calidad|liberada/);
  await fill('#buscar',fixture.serie);await click('#form-agregar button[type=submit]');await wait(`document.querySelector('#en-caja')?.innerText.includes(${JSON.stringify(fixture.serie)})`);
  await go('pages/empaque/formar-caja.html?caja='+caja);assert.match(await text(),new RegExp(fixture.serie));paso('Caja real, validacion de Calidad y contenido persistido al recargar');
  const cerrar=async()=>{await click('#cerrar');await click('dialog button[type=submit]');assert.ok(await evaluate("!!document.querySelector('#dialogo-error')?.innerText"));await fill('#dialogo-motivo','Pedido parcial verificado por QA');await click('dialog button[type=submit]');await wait("document.querySelector('#caja-activa')?.innerText.includes('Cerrada')");};
  await cerrar();paso('Cierre parcial exige motivo y se guarda');
  await go('pages/empaque/consultar-caja.html?caja='+caja);await click('#solicitar-reapertura');await fill('#dialogo-motivo','Revisar el contenido antes del envio');await click('dialog button[type=submit]');await wait("document.querySelector('#vista-operacion')?.innerText.includes('PENDIENTE')");assert.equal(await evaluate("!!document.querySelector('[data-autorizar-reapertura]')"),false);
  await salir();await login(fixture.supervisor,fixture.passwordSupervisor);await go('pages/empaque/consultar-caja.html?caja='+caja);await click('[data-autorizar-reapertura]');await click('dialog button[type=submit]');await wait("document.querySelector('#resultado')?.innerText.includes('Abierta')");
  await go('pages/empaque/formar-caja.html');assert.match(await text(),/No tienes permiso/);paso('Otra cuenta autoriza la reapertura; supervisor no puede formar cajas');
  await salir();await login(fixture.usuario,fixture.password);await go('pages/empaque/formar-caja.html?caja='+caja);await cerrar();
  await go('pages/embarques/armar-embarque.html');await fill('#emb-orden',String(fixture.orden));await fill('#emb-destino','Destino QA real');await fill('#emb-contenedor','CONT-QA-REAL');await click('#crear-embarque');await wait("!!document.querySelector('#embarque-activo table')");
  const embarque=await evaluate("new URLSearchParams(location.search).get('embarque')");report.embarque=embarque;
  await click(`[data-accion=asignar][data-caja="${caja}"]`);await wait("!!document.querySelector('[data-accion=retirar]')");
  await click('[data-accion=retirar]');await wait(`!!document.querySelector('[data-accion=asignar][data-caja="${caja}"]')`);await click(`[data-accion=asignar][data-caja="${caja}"]`);await wait("!!document.querySelector('[data-accion=retirar]')");
  await click('#btn-confirmar-emb');await click('dialog [data-cancelar]');assert.match(await text(),/Preparando/);await click('#btn-confirmar-emb');await click('dialog button[type=submit]');await wait("document.querySelector('#embarque-activo')?.innerText.includes('Enviado')");
  await go('pages/embarques/armar-embarque.html?embarque='+embarque);assert.match(await text(),/Enviado/);assert.match(await text(),/Destino QA real/);paso('Embarque real: asignar, retirar, cancelar y confirmar salida; datos persistidos');
  await go('pages/embarques/rastreo-de-contenedor.html');await fill('#busqueda-contenedor','CONT-QA-REAL');await click('#form-rastreo button[type=submit]');await wait("document.querySelector('#vista-operacion').innerText.includes('Destino QA real')");paso('Rastreo consulta destino y contenedor reales');
  assert.equal(await evaluate("localStorage.getItem('novasound.mock.operacion')"),null);assert.ok(report.peticiones.some(r=>r.metodo==='POST'&&r.ruta.endsWith('/salida')));assert.deepEqual(report.errores,[]);paso('Las operaciones viajan por API y no se guardan como mocks');
  const token=await evaluate("JSON.parse(sessionStorage.getItem('novasound.sesion')).token");await salir();
  const response=await fetch(new URL('/api/v1/almacen/cajas',base),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id_orden:fixture.orden})});assert.equal(response.status,401);paso('Cerrar sesion revoca el token en PostgreSQL');
}catch(e){report.fallo=e.stack;console.error(e.message);process.exitCode=1;}
finally{fs.writeFileSync(path.join(temporal,'resultado.json'),JSON.stringify(report,null,2));ws?.close();browser.kill();console.log('Evidencia:',temporal);}
