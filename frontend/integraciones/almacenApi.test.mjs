import test from 'node:test';
import assert from 'node:assert/strict';
import { AlmacenApiError, createAlmacenApi } from './almacenApi.mjs';

test('GET unidades disponibles: query params y sin body', async () => {
  let llamada;
  const api = createAlmacenApi({ fetchImpl: async (url, opts) => {
    llamada = { url, opts };
    return { ok: true, status: 200, text: async () => '[]' };
  }});
  assert.deepEqual(await api.disponibles(21, 'SN 001', 25), []);
  assert.match(llamada.url, /id_orden=21/);
  assert.match(llamada.url, /buscar=SN\+001/);
  assert.match(llamada.url, /limite=25/);
  assert.equal(llamada.opts.method, 'GET');
  assert.equal(llamada.opts.body, undefined);
});

test('POST creación caja: JSON y sesión', async () => {
  let llamada;
  const api = createAlmacenApi({ fetchImpl: async (url, opts) => {
    llamada = { url, opts };
    return { ok: true, status: 201, text: async () => '{"id_caja": 100}' };
  }});
  assert.deepEqual(await api.formarCaja(7), { id_caja: 100 });
  assert.deepEqual(JSON.parse(llamada.opts.body), { id_orden: 7 });
  assert.equal(llamada.opts.credentials, 'include');
  assert.equal(llamada.url, '/api/v1/almacen/cajas');
});

test('Errores HTTP 409 disponibles para pantalla de operación', async () => {
  const api = createAlmacenApi({ fetchImpl: async () => ({
    ok: false, status: 409,
    text: async () => '{"detail":"Unidad no liberada por Calidad"}',
  }) });
  await assert.rejects(() => api.agregarUnidad(10, 'SIM-123'), e => {
    assert.ok(e instanceof AlmacenApiError);
    assert.equal(e.status, 409);
    assert.match(e.message, /no liberada/);
    return true;
  });
});
