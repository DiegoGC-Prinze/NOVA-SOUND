// El transporte compartido agrega la sesión y convierte errores HTTP a ErrorApi.
export function crearClienteCalidad(solicitar) {
  const raiz = '/api/v1/calidad';
  const consulta = filtros => {
    const q = new URLSearchParams(Object.entries(filtros || {}).filter(([,v]) => v !== '' && v != null));
    return q.size ? `?${q}` : '';
  };
  const get = (ruta, filtros) => solicitar(raiz + ruta + consulta(filtros));
  const post = (serie, accion, cuerpo) => solicitar(`${raiz}/unidades/${encodeURIComponent(serie)}/${accion}`, { metodo: 'POST', cuerpo });
  return {
    obtenerResumen: filtros => get('/resumen', filtros),
    buscarUnidad: serie => get(`/unidades/${encodeURIComponent(serie)}`),
    obtenerDefectos: () => get('/defectos'),
    catalogos: () => get('/catalogos'),
    registrarInspeccion: (serie, datos) => post(serie, 'inspeccion', datos),
    obtenerTrazabilidad: serie => get(`/trazabilidad/${encodeURIComponent(serie)}`),
    retenciones: filtros => get('/retenciones', filtros),
    resolverRetencion: (serie, datos) => post(serie, 'retencion/resolver', datos),
    retrabajos: filtros => get('/retrabajos', filtros),
    guardarRetrabajo: (serie, datos) => post(serie, 'retrabajo', datos),
    reportes: filtros => get('/reportes', filtros),
  };
}
