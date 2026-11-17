"""Inspección, retención, retrabajo y reportes con transacciones y sesión real."""
from collections import defaultdict
from app.modules import gestion as g
from . import repository as r


def unidad_bloqueada(cx, serie):
    u = r.obtener_unidad_por_serie(cx, serie, True)
    if not u:
        g.error(404,'No se encontró la unidad en PostgreSQL.')
    if u['id_caja'] is not None or u['estado'] in {'EMPACADA','EMBARCADA','SCRAP'}:
        g.error(409,'La unidad está empacada, embarcada o descartada; no se puede modificar.')
    return u


def validar_prueba(cx, uid):
    prueba = r.ultima_prueba(cx, uid)
    if not prueba or prueba['resultado'] not in {'APROBADO','Aprobada','APROBADA'}:
        g.error(409,'Primero debe aprobarse la prueba funcional de la unidad.')
    if prueba['resultados'] is not None and (set(prueba['resultados']) != {'encendido','audio','carga','bluetooth'} or any(v != 'Aprobada' for v in prueba['resultados'].values())):
        g.error(409,'La prueba funcional vigente no está completamente aprobada.')


def validar_liberacion(cx, uid):
    validar_prueba(cx,uid)
    rr = r.ultimo_retrabajo(cx,uid)
    if rr and (rr['resultado'] is None or rr['resultado'] == 'No corregido'):
        g.error(409,'No se puede liberar: el retrabajo está pendiente o no corrigió el defecto.')


def registrar_evento(cx,u,actor,estado,observaciones,defectos,accion):
    estado_db = 'EN_RETRABAJO' if estado == 'RETRABAJO' else estado
    qid = r.ejecutar(cx,'''INSERT INTO calidad(id_unidad,id_usuario,estado,observaciones,evento,fecha)
        VALUES (:id,:a,:e,:obs,:evento,'''+g.AHORA+') RETURNING id_calidad',
        id=u['id_unidad'],a=actor['id_usuario'],e=estado_db,obs=observaciones,evento=accion).scalar_one()
    for d in defectos:
        r.ejecutar(cx,'INSERT INTO defectos(id_calidad,id_categoria,nombre,causa) VALUES (:q,:c,:n,:causa)',
            q=qid,c=d['id_categoria'],n=d['defecto'],causa=d.get('causa') or '')
    r.ejecutar(cx,'UPDATE unidades SET estado=:e WHERE id_unidad=:id',e=estado_db,id=u['id_unidad'])
    if estado == 'RETRABAJO':
        r.ejecutar(cx,'INSERT INTO retrabajo(id_unidad,id_calidad,fecha) VALUES (:id,:q,'+g.AHORA+')',id=u['id_unidad'],q=qid)
    g.auditar(cx,actor,'unidades',u['id_unidad'],'CALIDAD_'+accion,observaciones,
        antes={'estado':u['estado']},despues={'estado':estado_db,'id_calidad':qid})
    return {'ok':True,'estado':estado}


def validar_defectos(cx,defectos):
    catalogos = g.leer_catalogos(cx,True)
    resultado,vistos = [],set()
    for d in defectos:
        cat = next((i for i in catalogos['categorias']['items'] if i['nombre'] == d.categoria),None)
        if not cat or not any(i['nombre'] == d.defecto and i['codigo'].startswith(cat['codigo']+'-') for i in catalogos['defectos']['items']):
            g.error(422,'El defecto o su categoría no existen o están inactivos en Sistemas.')
        if (cat['id'],d.defecto) in vistos:
            g.error(422,'No repitas el mismo defecto en una inspección.')
        vistos.add((cat['id'],d.defecto))
        resultado.append(dict(id_categoria=cat['id'],defecto=d.defecto,causa=d.causa.strip()))
    return resultado


def procesar_inspeccion(cx,serie,datos,actor):
    u = unidad_bloqueada(cx,serie)
    if u['estado'] != 'PROBADA':
        g.error(409,'La unidad no está pendiente de inspección de Calidad.')
    validar_prueba(cx,u['id_unidad'])
    if datos.disposicion == 'LIBERADA' and datos.defectos:
        g.error(422,'Una unidad con defectos no se puede liberar.')
    if datos.disposicion != 'LIBERADA' and not datos.defectos:
        g.error(422,'Registra al menos un defecto para esa disposición.')
    if datos.disposicion == 'SCRAP' and not datos.observaciones.strip():
        g.error(422,'Explica el motivo de scrap en las observaciones.')
    if datos.disposicion == 'LIBERADA':
        validar_liberacion(cx,u['id_unidad'])
    return registrar_evento(cx,u,actor,datos.disposicion,datos.observaciones.strip(),validar_defectos(cx,datos.defectos),'INSPECCION')


def resolver_retencion(cx,serie,datos,actor):
    u = unidad_bloqueada(cx,serie)
    if u['estado'] != 'EN_RETENCION':
        g.error(409,'La unidad ya no está en retención.')
    if datos.disposicion != 'EN_RETENCION' and not datos.observaciones.strip():
        g.error(422,'Escribe las observaciones de la disposición.')
    if datos.disposicion == 'LIBERADA':
        validar_liberacion(cx,u['id_unidad'])
    q = r.ultima_inspeccion(cx,u['id_unidad'])
    defectos = r.defectos_inspeccion(cx,q['id_calidad']) if q else []
    ds = [dict(id_categoria=d['id_categoria'],defecto=d['nombre'] or d['categoria'],causa=d['causa']) for d in defectos] if datos.disposicion != 'LIBERADA' else []
    return registrar_evento(cx,u,actor,datos.disposicion,datos.observaciones.strip(),ds,'RETENCION')


def guardar_retrabajo(cx,serie,datos,actor):
    u = unidad_bloqueada(cx,serie)
    rr = r.ultimo_retrabajo(cx,u['id_unidad'])
    if u['estado'] not in {'RETRABAJO','EN_RETRABAJO'} or not rr or rr['resultado'] is not None:
        g.error(409,'El retrabajo no está pendiente o ya se registró.')
    if not datos.descripcion.strip():
        g.error(422,'Describe el retrabajo realizado.')
    r.ejecutar(cx,'''UPDATE retrabajo SET descripcion=:d,resultado=:r,observaciones=:obs,id_usuario=:a,
        fecha_fin='''+g.AHORA+' WHERE id_retrabajo=:id',d=datos.descripcion.strip(),r=datos.resultado,
        obs=datos.observaciones.strip(),a=actor['id_usuario'],id=rr['id_retrabajo'])
    r.ejecutar(cx,"UPDATE unidades SET estado='PROBADA' WHERE id_unidad=:id",id=u['id_unidad'])
    g.auditar(cx,actor,'unidades',u['id_unidad'],'CALIDAD_RETRABAJO',datos.observaciones,
        despues={'resultado':datos.resultado,'estado':'PROBADA'})
    return {'ok':True}


def filas_calidad(cx):
    filas = []
    for u in g.unidades(cx):
        q = r.ultima_inspeccion(cx,u['id_unidad'])
        if not q:
            continue
        ds = r.defectos_inspeccion(cx,q['id_calidad'])
        d = ds[0] if ds else {}
        filas.append(dict(u,fecha=q['fecha'].date().isoformat(),hora=q['fecha'].strftime('%H:%M'),
            inspector=q['inspector'],categoria=d.get('categoria',''),motivo=d.get('nombre') or d.get('categoria',''),
            observaciones=q['observaciones'],causa=d.get('causa','')))
    return filas


def filtrar(filas,q='',linea='',modelo='',fecha=None,turno=None,**extra):
    return [f for f in filas if (not q or q.casefold() in (f['serie'] or '').casefold())
        and (not linea or f['linea'] == linea) and (not modelo or f['modelo'] == modelo)
        and (not fecha or f['fecha'] == fecha.isoformat()) and (not turno or f['turno'] == turno)]


def retenciones(cx,filtros):
    todas = [f for f in filas_calidad(cx) if f['estado'] == 'EN_RETENCION']
    return {'filas':filtrar(todas,**filtros),'resumen':{'retenidas':len(todas),
        'retenidasHoy':sum(f['fecha'] == g.hoy(cx).isoformat() for f in todas)}}


def retrabajos(cx,filtros):
    us = {u['id_unidad']:u for u in g.unidades(cx)}
    filas = []
    for rr in r.todos(cx,'SELECT DISTINCT ON(id_unidad) * FROM retrabajo ORDER BY id_unidad,id_retrabajo DESC'):
        u = us[rr['id_unidad']]
        ds = r.defectos_inspeccion(cx,rr['id_calidad'])
        d = ds[0] if ds else {}
        filas.append(dict(u,fecha=rr['fecha'].date().isoformat(),estado='Finalizado' if rr['resultado'] is not None else 'Pendiente',
            categoria=d.get('categoria',''),motivo=d.get('nombre') or d.get('categoria',''),causa=d.get('causa',''),
            fechaRetrabajo=rr['fecha_fin'].date().isoformat() if rr['fecha_fin'] else None,
            descripcion=rr['descripcion'] or '',resultado=rr['resultado'],observaciones=rr['observaciones']))
    return {'filas':[f for f in filtrar(filas,**filtros) if not filtros.get('estado') or f['estado'] == filtros['estado']],
        'resumen':{'pendientes':sum(f['estado'] == 'Pendiente' for f in filas),'finalizadas':sum(f['estado'] == 'Finalizado' for f in filas)}}


def reporte(cx,desde,hasta,filtros):
    if desde > hasta or (hasta-desde).days > 366:
        g.error(422,'Selecciona un intervalo de hasta 366 días en orden cronológico.')
    us = {u['id_unidad']:u for u in g.unidades(cx)}
    qs = r.todos(cx,'''SELECT DISTINCT ON(id_unidad) * FROM calidad WHERE fecha::date BETWEEN :d AND :h
        ORDER BY id_unidad,fecha DESC,id_calidad DESC''',d=desde,h=hasta)
    seleccion = [q for q in qs if filtrar([dict(us[q['id_unidad']],fecha=q['fecha'].date().isoformat())],**filtros)]
    disp = dict(liberadas=0,retenidas=0,retrabajo=0,scrap=0)
    clave = {'LIBERADA':'liberadas','EMPACADA':'liberadas','EMBARCADA':'liberadas','EN_RETENCION':'retenidas','EN_RETRABAJO':'retrabajo','RETRABAJO':'retrabajo','SCRAP':'scrap'}
    for q in seleccion:
        if q['estado'] in clave:
            disp[clave[q['estado']]] += 1
    hallazgos = r.todos(cx,'''SELECT d.*,c.nombre AS categoria,q.id_unidad FROM defectos d
        JOIN cat_defectos c USING(id_categoria) JOIN calidad q USING(id_calidad)
        WHERE q.fecha::date BETWEEN :d AND :h AND q.evento='INSPECCION' ''',d=desde,h=hasta)
    grupos = defaultdict(int)
    for d in hallazgos:
        if filtrar([dict(us[d['id_unidad']],fecha=desde.isoformat())],**filtros):
            grupos[(d['categoria'],d['nombre'] or d['categoria'])] += 1
    total = sum(grupos.values())
    detalle = [dict(categoria=c,defecto=d,cantidad=n,porcentaje=n*100/total if total else 0) for (c,d),n in grupos.items()]
    categorias = defaultdict(int)
    for d in detalle:
        categorias[d['categoria']] += d['cantidad']
    return {'desde':desde,'hasta':hasta,'total':sum(disp.values()),'disposiciones':disp,
        'totalDefectos':total,'detalleDefectos':detalle,
        'defectosPorCategoria':[dict(categoria=c,cantidad=n,porcentaje=n*100/total if total else 0) for c,n in categorias.items()]}


def obtener_resumen_calidad(cx,filtros):
    today = g.hoy(cx)
    datos = reporte(cx,today,today,filtros)
    pendientes = [dict(u,**g.tiempo(u['fecha_hora'])) for u in g.unidades(cx) if u['estado'] == 'PROBADA']
    return dict(disposiciones=datos['disposiciones'],defectosPorCategoria=datos['defectosPorCategoria'],
        pendientes=filtrar(pendientes,**filtros),**datos['disposiciones'])
