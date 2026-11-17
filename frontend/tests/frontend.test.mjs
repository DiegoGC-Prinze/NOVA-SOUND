// Sin dependencias: node frontend/tests/frontend.test.mjs
// Prueba la demo en un perfil temporal de Edge/Chrome, sin tocar datos personales.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-front-test-'));
const navegador = [process.env.NOVA_TEST_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p => fs.existsSync(p));
assert.ok(navegador, 'Instala Edge/Chrome o define NOVA_TEST_BROWSER con su ruta.');
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer(async (req, res) => {
  try {
    const archivo = path.resolve(raiz, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!archivo.startsWith(raiz + path.sep)) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(archivo)] || 'application/octet-stream');
    res.end(await fsp.readFile(archivo));
  } catch { res.writeHead(404); res.end('No encontrado'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origen = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(navegador, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${temporal}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const resultados = [], erroresJS = [];
let ws;
try {
  let puerto;
  for (let i = 0; i < 150; i++) { try { puerto = fs.readFileSync(path.join(temporal, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {} await sleep(100); }
  assert.ok(puerto, 'El navegador no pudo iniciar.');
  const paginas = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
  ws = new WebSocket(paginas.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let secuencia = 0;
  const pendientes = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pendientes.get(m.id); if (p) { pendientes.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    if (m.method === 'Runtime.exceptionThrown') erroresJS.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const enviar = (method, params = {}) => new Promise((resolve, reject) => { const id = ++secuencia; const reloj = setTimeout(() => { pendientes.delete(id); reject(new Error(`Timeout: ${method}`)); }, 25000); pendientes.set(id, { resolve: r => { clearTimeout(reloj); resolve(r); }, reject: e => { clearTimeout(reloj); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluar = async codigo => { const r = await enviar('Runtime.evaluate', { expression: `(async()=>(${codigo}))()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await enviar('Page.enable'); await enviar('Runtime.enable');
  const ir = async (ruta, espera = 700) => { await enviar('Page.navigate', { url: `${origen}/${ruta}` }); await sleep(150); for (let i = 0; i < 40; i++) { if (await evaluar("document.readyState==='complete'")) break; await sleep(50); } await sleep(espera); };
  const api = (fn, ...args) => evaluar(`await(await import('/js/api.js'))[${JSON.stringify(fn)}](...${JSON.stringify(args)})`);
  const entrar = empleado => evaluar(`(async()=>{const s=await(await import('/js/api.js')).iniciarSesion('${empleado}','nova123');(await import('/js/session.js')).guardarSesion(s);return s;})()`);
  const click = selector => evaluar(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Falta '+${JSON.stringify(selector)});e.click();return true;})()`);
  const llenar = (selector, valor) => evaluar(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Falta '+${JSON.stringify(selector)});e.value=${JSON.stringify(valor)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  const texto = () => evaluar("document.querySelector('#contenido')?.innerText || document.body.innerText");
  const esperar = async condicion => { for (let i = 0; i < 60; i++) { if (await evaluar(condicion)) return; await sleep(100); } throw new Error('No se cumplió: ' + condicion); };
  const rechazo = async (fn, ...args) => { const r = await evaluar(`(async()=>{try{await(await import('/js/api.js'))[${JSON.stringify(fn)}](...${JSON.stringify(args)});return {aceptada:true};}catch(e){return {aceptada:false,mensaje:e.message,estado:e.estado};}})()`); assert.equal(r.aceptada, false, 'La operación inválida fue aceptada'); return r; };
  const prueba = async (nombre, tarea) => { try { await tarea(); resultados.push({ nombre, ok: true }); console.log('OK', nombre); } catch (e) { resultados.push({ nombre, ok: false, error: e.stack }); console.error('ERROR', nombre, e.message); } };
  await ir('index.html');
  await evaluar('localStorage.clear(); sessionStorage.clear()'.replace(';', ','));
  const completo = { encendido: 'Aprobada', audio: 'Aprobada', carga: 'Aprobada', bluetooth: 'Aprobada' };
  let caja, embarque, solicitud;
  await prueba('Login desde formulario y rechazo de cuentas inválidas', async () => {
    await ir('index.html');
    await llenar('#modo-login', 'demo');
    const selector = await evaluar("'#'+[...document.querySelectorAll('#form-login input')].find(e=>e.type!=='password').id");
    await llenar(selector, '1001'); await llenar('#contrasena', 'nova123'); await click('#entrar'); await esperar("location.pathname.includes('tablero-de-produccion')");
    await rechazo('iniciarSesion', '1001', 'incorrecta'); await rechazo('iniciarSesion', '1003', 'nova123');
  });
  await prueba('Las 41 pantallas cargan sin errores con sus roles reales', async () => {
    const pantallas = await evaluar("(await import('/js/menu.js')).PANTALLAS.filter(p=>p.area!=='login')");
    const cuentas = ['1001','2001','3001','4001','4002','5002','9001'];
    const sesiones = [];
    for (const num of cuentas) sesiones.push(await entrar(num));
    for (const p of pantallas) {
      const s = sesiones.find(s => s.permisos[p.id]); assert.ok(s, 'Sin rol para ' + p.id);
      await evaluar(`(await import('/js/session.js')).guardarSesion(${JSON.stringify(s)})`); await ir(p.ruta);
      assert.ok((await texto()).length > 30, p.id + ' vacía');
      assert.equal(await evaluar("document.querySelector('#error-operacion')?.innerText || ''"), '', p.id);
    }
  });
  await prueba('Registro desde formulario, persistencia y cola compartida', async () => {
    await entrar('1001'); await ir('pages/produccion/registrar-produccion.html');
    await llenar('#rp-lote', 'L-TEST'); await llenar('#rp-serie', 'NOVA-TEST-001'); await click('#btn-guardar-prod');
    await esperar("document.querySelector('tbody')?.innerText.includes('NOVA-TEST-001')");
    await ir('pages/prueba-funcional/unidades-por-probar.html'); assert.match(await texto(), /NOVA-TEST-001/);
    await ir('pages/produccion/registrar-produccion.html'); assert.match(await texto(), /NOVA-TEST-001/);
    assert.equal((await api('unidadPorSerie','NOVA-TEST-001')).estado, 'ENSAMBLADA');
  });
  await prueba('Validaciones visibles, serie duplicada y escritura simultánea', async () => {
    await click('#btn-guardar-prod'); await esperar("!!document.querySelector('#error-operacion')?.innerText");
    assert.equal((await rechazo('operar', 'registrarUnidad', { serie:'NOVA-TEST-001', lote:'L-TEST', orden:'OP-1041', turno:1 })).estado, 409);
    const r = await evaluar("Promise.allSettled([1,2].map(()=>import('/js/api.js').then(a=>a.operar('registrarUnidad',{serie:'NOVA-TEST-RACE',lote:'L-TEST',orden:'OP-1041',turno:1})))).then(rs=>rs.map(r=>r.status))");
    assert.equal(r.filter(s=>s==='fulfilled').length,1);
  });
  await prueba('Pruebas incompletas rechazadas; aprobación llega a Calidad', async () => {
    await rechazo('operar','guardarPrueba',{serie:'NOVA-TEST-001',prueba:{encendido:'Aprobada'}});
    await ir('pages/prueba-funcional/registro-de-pruebas-funcionales.html?unidad=NOVA-TEST-001');
    for (const k of Object.keys(completo)) await click(`input[name="prueba-${k}"][value="Aprobada"]`);
    await click('#btn-guardar'); await esperar("document.querySelector('#vista-operacion')?.innerText.includes('Resultado registrado')");
    await entrar('3001'); assert.ok((await api('resumenCalidad',{})).pendientes.some(u=>u.serie==='NOVA-TEST-001'));
    await ir('pages/calidad/inspeccion-de-unidad.html?serie=NOVA-TEST-001',1000);
    await click('input[name="disposicion"][value="LIBERADA"]'); await click('#guardar'); await sleep(650);
    assert.equal((await api('unidadPorSerie','NOVA-TEST-001')).estado,'LIBERADA');
  });
  await prueba('Fallas funcionales persisten y exigen observaciones', async () => {
    await entrar('1001'); await api('operar','registrarUnidad',{serie:'NOVA-TEST-FAIL',lote:'L-TEST',orden:'OP-1041',turno:1});
    const falla={...completo,audio:'Falla'};
    await rechazo('operar','guardarPrueba',{serie:'NOVA-TEST-FAIL',prueba:falla});
    await api('operar','guardarPrueba',{serie:'NOVA-TEST-FAIL',prueba:falla,observaciones:'Audio distorsionado'});
    assert.equal((await api('unidadPorSerie','NOVA-TEST-FAIL')).estado,'FALLA_FUNCIONAL');
    await entrar('3001');
    await rechazo('guardarInspeccion','NOVA-TEST-FAIL',{disposicion:'LIBERADA'});
  });
  await prueba('Empaque usa la capacidad configurada en Sistemas', async () => {
    await entrar('9001'); const p=await api('parametros'); await api('guardarParametros',{capacidadCaja:{...p.capacidadCaja,'NS-MINI':1},motivo:'Prueba de capacidad compartida'});
    await entrar('4001'); caja=await api('operar','crearCaja',{orden:'OP-1041'}); assert.equal(caja.capacidad,1);
    await ir('pages/empaque/formar-caja.html?caja='+caja.id); assert.match(await texto(),new RegExp(caja.id));
    await llenar('#buscar','NOVA-TEST-001'); await click('#form-agregar button[type=submit]');
    await esperar("document.querySelector('#en-caja')?.innerText.includes('NOVA-TEST-001')");
    await ir('pages/empaque/formar-caja.html?caja='+caja.id); assert.match(await evaluar("document.querySelector('#en-caja').innerText"),/NOVA-TEST-001/);
    await rechazo('operar','agregarUnidad',{caja:caja.id,serie:'NOVA-TEST-FAIL'});
  });
  await prueba('Cerrar caja desde formulario y consultar el mismo registro', async () => {
    await click('#cerrar'); await click('dialog button[type=submit]'); await esperar("document.querySelector('#vista-operacion')?.innerText.includes('Cerrada')");
    await ir('pages/empaque/consultar-caja.html?caja='+caja.id); assert.match(await texto(),/NOVA-TEST-001/); assert.match(await texto(),/Cerrada/);
    await rechazo('operar','quitarUnidad',{caja:caja.id,serie:'NOVA-TEST-001'});
  });
  await prueba('Embarque respeta orden y caja; salida actualiza trazabilidad', async () => {
    embarque=await api('operar','crearEmbarque',{orden:'OP-1041',destino:'Centro de distribución',contenedor:'CONT-TEST'});
    const otro=await api('operar','crearEmbarque',{orden:'OP-1042',destino:'Otro destino'});
    await rechazo('operar','asignarCaja',{embarque:otro.id,caja:caja.id});
    await api('operar','asignarCaja',{embarque:embarque.id,caja:caja.id});
    await rechazo('operar','asignarCaja',{embarque:embarque.id,caja:caja.id});
    await ir('pages/embarques/armar-embarque.html?embarque='+embarque.id); await click('#btn-confirmar-emb'); await click('dialog button[type=submit]');
    await esperar("document.querySelector('#embarque-activo')?.innerText.includes('Enviado')");
    const u=await api('unidadPorSerie','NOVA-TEST-001'); assert.equal(u.estado,'EMBARCADA'); assert.equal(u.embarque.referencia,embarque.id); assert.ok(u.historial.some(e=>e.area==='Embarques'&&e.evento.includes('Salida')));
    await ir('pages/embarques/rastreo-de-contenedor.html'); await llenar('#busqueda-contenedor','CONT-TEST'); await click('#form-rastreo button[type=submit]'); await esperar(`document.querySelector('#vista-operacion')?.innerText.includes('${embarque.id}')`);
  });
  await prueba('Cierre persiste y bloquea registros; reapertura requiere Gerencia', async () => {
    await entrar('2001'); await ir('pages/produccion/cierre-de-turno.html'); await click('#btn-cerrar-turno'); await llenar('#dialogo-motivo','Cierre de prueba'); await click('dialog button[type=submit]');
    await esperar("document.querySelector('#btn-cerrar-turno')?.disabled===true"); await ir('pages/produccion/cierre-de-turno.html'); assert.equal(await evaluar("document.querySelector('#btn-cerrar-turno').disabled"),true);
    await entrar('1001'); await rechazo('operar','registrarUnidad',{serie:'NOVA-BLOCK',lote:'L-TEST',orden:'OP-1041',turno:1});
    await entrar('2001'); solicitud=await api('operar','solicitarAjuste',{orden:'OP-1041',turno:1,tipo:'Reapertura de turno',motivo:'Faltan registros'});
    await entrar('5002'); assert.ok((await api('autorizaciones')).pendientes.some(a=>a.id===solicitud.id));
    assert.ok((await api('cierresTurno',{linea:'L1',turno:1})).some(r=>r.estado==='Cerrado'&&r.nota==='Cierre de prueba'));
    await api('resolverAutorizacion',solicitud.id,{decision:'aprobar'});
    assert.ok((await api('cierresTurno',{linea:'L1',turno:1})).some(r=>r.estado==='Reabierto'));
    await entrar('1001'); await api('operar','registrarUnidad',{serie:'NOVA-AFTER-OPEN',lote:'L-TEST',orden:'OP-1041',turno:1});
  });
  await prueba('Corrección autorizada actualiza los indicadores compartidos', async () => {
    await entrar('2001'); const d=await api('consultarOperacion'); const actual=d.resumen.filter(r=>r.dia===0&&r.orden==='OP-1041'&&r.turno===1).reduce((s,r)=>s+r.reportadas,0);
    const a=await api('operar','solicitarAjuste',{orden:'OP-1041',turno:1,nuevo:actual+2,motivo:'Conteo verificado'});
    await entrar('5002'); await api('resolverAutorizacion',a.id,{decision:'aprobar'});
    const nuevo=await api('consultarOperacion'); assert.equal(nuevo.resumen.filter(r=>r.dia===0&&r.orden==='OP-1041'&&r.turno===1).reduce((s,r)=>s+r.reportadas,0),actual+2);
    const dashboard=await api('dashboard',{orden:'OP-1041',turno:1}); assert.equal(dashboard.resumen.producidas,actual+2);
  });
  await prueba('Permisos de escritura y caja enviada protegidos', async () => {
    await entrar('1001'); await rechazo('operar','crearCaja',{orden:'OP-1041'}); await rechazo('operar','cerrarTurno',{linea:'L1',turno:1,motivo:'Sin permiso'});
    await ir('pages/produccion/cierre-de-turno.html'); assert.match(await texto(),/No tienes permiso/);
    await entrar('2001'); await ir('pages/produccion/registrar-incidencia.html'); assert.equal(await evaluar("!!document.querySelector('#btn-inc')"),false);
    await entrar('4002'); await rechazo('operar','reabrirCaja',{caja:caja.id,motivo:'Ya enviada'});
  });
  await prueba('Incidencias se conservan y validan tiempo de paro', async () => {
    await entrar('1001');
    await rechazo('operar','registrarIncidencia',{linea:'L1',motivo:'Error de equipo',paro:-1});
    await api('operar','registrarIncidencia',{linea:'L1',tipo:'Equipo',severidad:'Alta',motivo:'INC-PRUEBA-PERSISTENTE',paro:10});
    await ir('pages/produccion/registrar-incidencia.html'); assert.match(await texto(),/INC-PRUEBA-PERSISTENTE/);
    await entrar('2001'); await rechazo('operar','registrarIncidencia',{linea:'L1',motivo:'Sin permiso de escritura',paro:0});
  });
  await prueba('Caja incompleta exige motivo; reapertura y retiro conservan historial', async () => {
    await entrar('1001'); await api('operar','registrarUnidad',{serie:'NOVA-PARTIAL',lote:'L-PARTIAL',orden:'OP-1042',turno:1}); await api('operar','guardarPrueba',{serie:'NOVA-PARTIAL',prueba:completo});
    await entrar('3001'); await api('guardarInspeccion','NOVA-PARTIAL',{disposicion:'LIBERADA'});
    await entrar('4001'); const b=await api('operar','crearCaja',{orden:'OP-1042'});
    await rechazo('operar','agregarUnidad',{caja:b.id,serie:'NOVA-TEST-001'});
    await api('operar','agregarUnidad',{caja:b.id,serie:'NOVA-PARTIAL'});
    await rechazo('operar','cerrarCaja',{caja:b.id,validado:true});
    await api('operar','cerrarCaja',{caja:b.id,validado:true,motivo:'Fin de pedido'});
    await entrar('4002'); await rechazo('operar','reabrirCaja',{caja:b.id,motivo:''}); await api('operar','reabrirCaja',{caja:b.id,motivo:'Revisar contenido'});
    await entrar('4001'); await api('operar','quitarUnidad',{caja:b.id,serie:'NOVA-PARTIAL'});
    const u=await api('unidadPorSerie','NOVA-PARTIAL'); assert.equal(u.estado,'LIBERADA');assert.equal(u.caja,null); assert.ok(u.historial.some(h=>h.evento.includes('reabierta'))); assert.ok(u.historial.some(h=>h.evento.includes('Retirada')));
  });
  await prueba('Sin sesión no se puede consultar ni modificar la operación', async () => {
    await evaluar('sessionStorage.clear()'); await rechazo('consultarOperacion'); await ir('pages/empaque/formar-caja.html'); assert.equal(await evaluar('location.pathname'),'/index.html');
  });
  await prueba('Migración de permisos guardados y restablecimiento de la demo', async () => {
    await entrar('9001');
    await evaluar("(async()=>{const db=await import('/js/mockdb.js');const r=await db.leerJSON('roles-permisos');delete r.version;for(const role of r.roles){delete role.permisos['embarques/cierre-de-caja-escaneo'];delete role.permisos['embarques/confirmacion-de-cierre-de-caja'];}db.guardarColeccion('roles-permisos',r);})()");
    const s=await entrar('4001'); assert.equal(s.permisos['embarques/cierre-de-caja-escaneo'],'acciona');
    await api('reiniciarMocks'); const d=await api('consultarOperacion'); assert.equal(d.cajas.length,0); assert.equal(d.embarques.length,0); assert.equal(d.unidades.filter(u=>u.nueva).length,0); assert.equal(d.parametros.capacidadCaja['NS-MINI'],12);
  });
  await prueba('No hubo excepciones JavaScript sin manejar', async () => assert.deepEqual(erroresJS, []));
} catch (e) { resultados.push({ nombre: 'Ejecutor de pruebas', ok: false, error: e.stack }); console.error(e); }
finally { ws?.close(); browser.kill(); await new Promise(r=>server.close(r)); }
fs.writeFileSync(path.join(temporal, 'resultados.json'), JSON.stringify({ resultados, erroresJS }, null, 2));
console.log(`Resultado: ${resultados.filter(r=>r.ok).length}/${resultados.length}. Evidencia: ${temporal}`);
if (resultados.some(r=>!r.ok)) process.exitCode=1;
