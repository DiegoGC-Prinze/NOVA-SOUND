"""API de Calidad integrada con la autenticación compartida."""
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from app.core.acceso import actor_actual, exigir, exigir_alguna
from app.modules import gestion as g
from . import service, schemas, repository as r
from .auth import verificar_permisos_inspector, PANTALLAS

router = APIRouter(prefix='/api/v1/calidad', tags=['Calidad'])


@router.get('/resumen')
def resumen(turno: int | None = None, linea: str = '', actor=Depends(actor_actual)):
    exigir(actor,'calidad/resumen-de-calidad')
    with g.db() as cx:
        return service.obtener_resumen_calidad(cx,dict(turno=turno,linea=linea))


@router.get('/unidades/{serie}')
def buscar_unidad(serie: str, actor=Depends(actor_actual)):
    exigir_alguna(actor,PANTALLAS)
    datos = g.detalle_trazabilidad(serie)
    if datos['estado'] == 'EN_RETRABAJO':
        datos['estado'] = 'RETRABAJO'
    return dict(datos,numero_serie=datos['serie'])


@router.get('/catalogos')
def catalogos(actor=Depends(actor_actual)):
    exigir_alguna(actor,PANTALLAS)
    with g.db() as cx:
        return g.leer_catalogos(cx)


@router.get('/defectos')
def defectos(actor=Depends(actor_actual)):
    exigir_alguna(actor,PANTALLAS)
    with g.db() as cx:
        return r.obtener_categorias_defectos(cx)


@router.post('/unidades/{serie}/inspeccion')
def inspeccionar(serie: str, datos: schemas.InspeccionCrear, actor=Depends(actor_actual)):
    verificar_permisos_inspector(actor)
    with g.db() as cx:
        return service.procesar_inspeccion(cx,serie,datos,actor)


@router.post('/inspeccion')
def inspeccion_compatible(datos: schemas.InspeccionLegacy, actor=Depends(actor_actual)):
    verificar_permisos_inspector(actor)
    if datos.id_usuario is not None and datos.id_usuario != actor['id_usuario']:
        g.error(403,'El inspector debe ser la persona autenticada.')
    with g.db() as cx:
        ds = []
        if datos.id_categoria_defecto is not None:
            cat = next((c for c in g.leer_catalogos(cx,True)['categorias']['items'] if c['id'] == datos.id_categoria_defecto),None)
            if not cat:
                g.error(422,'Categoría inexistente o inactiva.')
            if not datos.defecto:
                g.error(422,'Especifica el defecto detectado o utiliza el formulario de inspección.')
            ds = [schemas.Defecto(categoria=cat['nombre'],defecto=datos.defecto,causa=datos.causa)]
        solicitud = schemas.InspeccionCrear(disposicion='RETRABAJO' if datos.estado == 'EN_RETRABAJO' else datos.estado,
            defectos=ds,observaciones=datos.causa)
        return service.procesar_inspeccion(cx,datos.numero_serie,solicitud,actor)


@router.get('/retenciones')
def retenciones(q: str = '', linea: str = '', modelo: str = '', fecha: date | None = None, actor=Depends(actor_actual)):
    exigir(actor,'calidad/retenciones')
    with g.db() as cx:
        return service.retenciones(cx,dict(q=q,linea=linea,modelo=modelo,fecha=fecha))


@router.post('/unidades/{serie}/retencion/resolver')
def resolver_retencion(serie: str, datos: schemas.DisponerRetencion, actor=Depends(actor_actual)):
    verificar_permisos_inspector(actor,'retenciones')
    with g.db() as cx:
        return service.resolver_retencion(cx,serie,datos,actor)


@router.get('/retrabajos')
def retrabajos(q: str = '', linea: str = '', modelo: str = '', fecha: date | None = None, estado: str = '', actor=Depends(actor_actual)):
    exigir(actor,'calidad/retrabajos')
    if estado not in {'','Pendiente','Finalizado'}:
        g.error(422,'Estado de retrabajo no válido.')
    with g.db() as cx:
        return service.retrabajos(cx,dict(q=q,linea=linea,modelo=modelo,fecha=fecha,estado=estado))


@router.post('/unidades/{serie}/retrabajo')
def guardar_retrabajo(serie: str, datos: schemas.RetrabajoCrear, actor=Depends(actor_actual)):
    verificar_permisos_inspector(actor,'retrabajos')
    with g.db() as cx:
        return service.guardar_retrabajo(cx,serie,datos,actor)


@router.get('/reportes')
def reportes(desde: date | None = None, hasta: date | None = None, turno: int | None = None,
             linea: str = '', modelo: str = '', actor=Depends(actor_actual)):
    exigir(actor,'calidad/reportes-de-calidad')
    with g.db() as cx:
        return service.reporte(cx,desde or g.hoy(cx)-timedelta(days=6),hasta or g.hoy(cx),dict(turno=turno,linea=linea,modelo=modelo))


@router.get('/trazabilidad/{serie}')
def trazabilidad(serie: str, actor=Depends(actor_actual)):
    exigir_alguna(actor,['calidad/historial-de-la-unidad','calidad/inspeccion-de-unidad'])
    datos = g.detalle_trazabilidad(serie)
    return datos['historial']
