"""Producción, Gerencia y Sistemas sobre PostgreSQL.

Comparte unidades y trazabilidad con Calidad y Pruebas funcionales.
Las consultas gerenciales leen sus registros existentes sin modificarlos.
"""
import json
import logging
import re
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.db.database import engine
from app.core.acceso import actor_actual, exigir, exigir_alguna, CONTRATOS, PANTALLAS, ACCIONES, ADMINISTRAR
from app.core.sesiones import hash_password
from app.modules.almacen.repository import todos, uno, ejecutar

router = APIRouter(prefix='/api/v1/gestion', tags=['Producción, Gerencia y Sistemas'])
log = logging.getLogger(__name__)
PRODUCCION = [p for p in PANTALLAS if p.startswith('produccion/')]
GERENCIA = [p for p in PANTALLAS if p.startswith('gerencia/')]
SISTEMAS = [p for p in PANTALLAS if p.startswith('sistemas/')]
AHORA = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')"
CATALOGOS = {'modelos': ('modelos', 'id_modelo', 'Modelos'), 'lineas': ('linea', 'id_linea', 'Líneas'),
             'turnos': ('turnos', 'id_turno', 'Turnos'), 'clientes': ('clientes', 'id_cliente', 'Clientes'),
             'categorias': ('cat_defectos', 'id_categoria', 'Categorías de defecto'), 'defectos': (None, None, 'Defectos')}


def error(status, mensaje):
    raise HTTPException(status, mensaje)


@contextmanager
def db():
    try:
        with engine.begin() as cx:
            cx.execute(text("SET LOCAL TIME ZONE 'America/Mexico_City'"))
            yield cx
    except IntegrityError as exc:
        error(409, 'El registro ya existe o tiene relaciones que impiden este cambio.')
    except SQLAlchemyError as exc:
        log.exception('Error PostgreSQL en Gestión')
        raise HTTPException(503, 'No se pudo completar la operación en PostgreSQL. Revisa la migración 07.') from exc


def auditar(cx, actor, tabla, rid, accion, motivo='', antes=None, despues=None):
    # No guardar contraseñas, tokens ni secretos en la bitácora.
    ejecutar(cx, '''INSERT INTO bitacora_general(id_usuario,id_registro_afectado,accion,
        tabla_afectada,valor_anterior,valor_nuevo,motivo,fecha_hora)
        VALUES (:u,:id,:a,:t,:antes,:despues,:motivo,''' + AHORA + ')',
        u=actor['id_usuario'], id=rid, a=accion, t=tabla,
        antes=json.dumps(antes, ensure_ascii=False, default=str)[:500] if antes is not None else None,
        despues=json.dumps(despues, ensure_ascii=False, default=str)[:500] if despues is not None else None,
        motivo=motivo[:500])


def hoy(cx):
    return ejecutar(cx, 'SELECT CURRENT_DATE').scalar_one()


def tiempo(valor):
    return {'fecha': valor.date().isoformat(), 'hora': valor.strftime('%H:%M')} if valor else {'fecha': None, 'hora': ''}


def entero(valor, nombre, minimo=1):
    if isinstance(valor, bool) or not re.fullmatch(r'\d+', str(valor)) or int(valor) < minimo:
        error(422, f'{nombre}: se requiere un entero mayor o igual a {minimo}.')
    return int(valor)


def requerido(datos, clave, maximo=300, minimo=1):
    valor = str(datos.get(clave) or '').strip()
    if not minimo <= len(valor) <= maximo:
        error(422, f'{clave}: escribe entre {minimo} y {maximo} caracteres.')
    return valor


def leer_catalogos(cx, activos=False):
    resultado = {}
    for tipo, (tabla, pk, nombre) in CATALOGOS.items():
        if tabla:
            codigo = {'modelos': 't.nombre', 'lineas': "'L'||t.id_linea", 'turnos': 't.id_turno::text',
                      'clientes': "'C'||t.id_cliente", 'categorias': "'CAT'||t.id_categoria"}[tipo]
            etiqueta = "'Turno '||t.id_turno" if tipo == 'turnos' else 't.nombre'
            items = todos(cx, f'''SELECT COALESCE(c.codigo,{codigo}) AS codigo,
                COALESCE(c.nombre,{etiqueta}) AS nombre,
                CASE WHEN COALESCE(c.activo,TRUE) THEN 'Activo' ELSE 'Inactivo' END AS estado,
                t.{pk} AS id FROM {tabla} t LEFT JOIN catalogos_web c
                ON c.tipo=:tipo AND c.id_original=t.{pk} ORDER BY t.{pk}''', tipo=tipo)
        else:
            items = todos(cx, "SELECT codigo,nombre,CASE WHEN activo THEN 'Activo' ELSE 'Inactivo' END AS estado FROM catalogos_web WHERE tipo=:tipo ORDER BY codigo", tipo=tipo)
        resultado[tipo] = {'nombre': nombre, 'items': [i for i in items if not activos or i['estado'] == 'Activo']}
    return resultado


def ordenes(cx):
    filas = todos(cx, '''SELECT o.*,cl.nombre AS cliente,m.nombre AS modelo,co.nombre AS color,
        COALESCE(c.codigo,'L'||o.id_linea) AS linea FROM ordenes o
        JOIN clientes cl USING(id_cliente) JOIN modelos m USING(id_modelo) JOIN colores co USING(id_color)
        LEFT JOIN catalogos_web c ON c.tipo='lineas' AND c.id_original=o.id_linea ORDER BY o.id_orden''')
    return [{**o, 'id': str(o['id_orden'])} for o in filas]


def unidades(cx, *, fecha=None):
    where = ' WHERE u.fecha_hora::date=:fecha' if fecha else ''
    return todos(cx, '''SELECT u.*,u.numero_serie AS serie,m.nombre AS modelo,co.nombre AS color,
        cl.nombre AS cliente,l.id_orden::text AS orden,COALESCE(l.codigo,'L-'||l.id_lote) AS lote,
        COALESCE(c.codigo,'L'||u.id_linea) AS linea,u.id_turno AS turno,
        u.id_usuario_registro IS NOT NULL AS nueva FROM unidades u JOIN lote l USING(id_lote)
        JOIN ordenes o USING(id_orden) JOIN modelos m USING(id_modelo) JOIN colores co ON co.id_color=u.id_color
        JOIN clientes cl USING(id_cliente) LEFT JOIN catalogos_web c ON c.tipo='lineas' AND c.id_original=u.id_linea
        ''' + where + ' ORDER BY u.fecha_hora,u.id_unidad', **({'fecha': fecha} if fecha else {}))


def metricas(cx, fecha=None):
    # Se agrupa por fecha de ensamble: una unidad aparece una sola vez, aun con varias inspecciones.
    fecha = fecha or hoy(cx)
    filas = unidades(cx, fecha=fecha)
    grupos = {}
    def grupo(orden, linea, turno, lote='', modelo=''):
        key = (orden, linea, turno, lote)
        return grupos.setdefault(key, dict(dia=(hoy(cx)-fecha).days, fecha=fecha.isoformat(), orden=orden,
            linea=linea, turno=turno, lote=lote, modelo=modelo, meta=0, reportadas=0,
            liberadas=0, retenidas=0, retrabajo=0, scrap=0, recibidas=0))
    for u in filas:
        g = grupo(u['orden'], u['linea'], u['turno'], u['lote'], u['modelo'])
        g['reportadas'] += 1
        e = u['estado']
        g['liberadas'] += int(e in {'LIBERADA', 'EMPACADA', 'EMBARCADA'})
        g['recibidas'] += int(e in {'EMPACADA', 'EMBARCADA'})
        g['retenidas'] += int(e == 'EN_RETENCION')
        g['retrabajo'] += int(e in {'RETRABAJO', 'EN_RETRABAJO'})
        g['scrap'] += int(e == 'SCRAP')
    ords = {o['id']: o for o in ordenes(cx)}
    for ajuste in todos(cx, 'SELECT id_orden::text AS orden,id_turno AS turno,SUM(diferencia) AS diferencia FROM ajustes_conteo_web WHERE fecha=:f GROUP BY id_orden,id_turno', f=fecha):
        o = ords[ajuste['orden']]
        grupo(o['id'], o['linea'], ajuste['turno'], 'Ajuste autorizado', o['modelo'])['reportadas'] += ajuste['diferencia']
    for objetivo in todos(cx, 'SELECT id_orden::text AS orden,id_turno AS turno,SUM(cantidad_objetivo) AS meta FROM objetivo_unidades WHERE fecha=:f GROUP BY id_orden,id_turno', f=fecha):
        o = ords[objetivo['orden']]
        # Meta por orden/turno, sin multiplicarla por el número de lotes.
        grupo(o['id'], o['linea'], objetivo['turno'], 'Objetivo', o['modelo'])['meta'] += objetivo['meta']
    return list(grupos.values())


def solicitudes(cx):
    filas = todos(cx, '''SELECT a.*,s.nombre AS solicita_nombre,rs.nombre AS solicita_rol,
        r.nombre AS resuelve_nombre,rr.nombre AS resuelve_rol FROM autorizacion a
        JOIN usuarios s ON s.id_usuario=a.id_usuario_solicita JOIN roles rs ON rs.id_rol=s.id_rol
        LEFT JOIN usuarios r ON r.id_usuario=a.id_usuario_autoriza LEFT JOIN roles rr ON rr.id_rol=r.id_rol
        WHERE a.tipo_referencia='PRODUCCION_WEB' ORDER BY a.id_autorizacion DESC''')
    return [dict(id=str(a['id_autorizacion']), **a['datos'], motivo=a['motivo'], estado=a['estado'],
        solicita={'nombre': a['solicita_nombre'], 'rol': a['solicita_rol']},
        resolvio={'nombre': a['resuelve_nombre'], 'rol': a['resuelve_rol']},
        fechaResolucion=tiempo(a['fecha_autorizacion'])['fecha'], horaResolucion=tiempo(a['fecha_autorizacion'])['hora'],
        motivoResolucion=a['motivo_resolucion'] or '', operacion=True, **tiempo(a['fecha_solicitud'])) for a in filas]


def cierres(cx):
    return todos(cx, '''SELECT c.id_cierre,c.fecha::date::text AS fecha,COALESCE(l.codigo,'L'||c.id_linea) AS linea,
        c.id_turno AS turno,c.estado,c.nota,u.nombre AS usuario,c.origen_web,c.total_reportadas,
        c.total_empacadas,c.total_retenidas,c.total_retrabajo,c.total_scrap
        FROM cierresturno c JOIN usuarios u USING(id_usuario) LEFT JOIN catalogos_web l
        ON l.tipo='lineas' AND l.id_original=c.id_linea ORDER BY c.fecha,c.id_cierre''')


@router.get('/opciones')
def opciones(actor=Depends(actor_actual)):
    exigir_alguna(actor, list(PANTALLAS))
    with db() as cx:
        cat = leer_catalogos(cx, True)
        return {'lineas': [i['codigo'] for i in cat['lineas']['items']],
                'turnos': [{'valor': i['id'], 'nombre': i['nombre']} for i in cat['turnos']['items']],
                'modelos': [i['nombre'] for i in cat['modelos']['items']], 'ordenes': ordenes(cx),
                'clientes': [i['nombre'] for i in cat['clientes']['items']],
                'categoriasDefecto': [i['nombre'] for i in cat['categorias']['items']]}


@router.get('/operacion')
def consultar_produccion(actor=Depends(actor_actual)):
    exigir_alguna(actor, PRODUCCION)
    with db() as cx:
        today = hoy(cx)
        return {'real': True, 'fecha': today.isoformat(), 'catalogos': leer_catalogos(cx, True),
                'ordenes': ordenes(cx), 'unidades': [{**u, **tiempo(u['fecha_hora'])} for u in unidades(cx, fecha=today)],
                'resumen': metricas(cx, today), 'autorizaciones': solicitudes(cx), 'cierres': cierres(cx),
                'incidencias': [{**i, 'id': str(i['id_incidencia']), **tiempo(i['fecha'])} for i in todos(cx,
                    """SELECT i.*,u.nombre AS usuario,COALESCE(l.codigo,'L'||i.id_linea) AS linea FROM incidencias_web i
                    JOIN usuarios u USING(id_usuario) LEFT JOIN catalogos_web l ON l.tipo='lineas' AND l.id_original=i.id_linea ORDER BY i.id_incidencia""") ]}


def bloquear_turno(cx, linea, turno, fecha):
    ejecutar(cx, 'SELECT pg_advisory_xact_lock(hashtextextended(:clave,0))', clave=f'produccion:{fecha}:{linea}:{turno}')


def cierre_actual(cx, linea, turno, fecha):
    return uno(cx, '''SELECT * FROM cierresturno WHERE id_linea=:l AND id_turno=:t AND fecha::date=:f
        ORDER BY origen_web DESC,fecha DESC,id_cierre DESC LIMIT 1 FOR UPDATE''', l=linea, t=turno, f=fecha)


def catalogo_activo(cx, tipo, valor):
    item = next((i for i in leer_catalogos(cx, True)[tipo]['items'] if str(i['codigo']) == str(valor) or str(i.get('id')) == str(valor)), None)
    if not item:
        error(422, f'El elemento de {tipo} no existe o está inactivo.')
    return item


@router.post('/operacion/{accion}')
def operar_produccion(accion: str, datos: dict, actor=Depends(actor_actual)):
    reglas = {'registrarUnidad': ('registrar-produccion', 'registrar-produccion'),
              'registrarIncidencia': ('registrar-incidencia', None),
              'solicitarAjuste': ('solicitar-ajuste', 'solicitar-ajuste-de-produccion-o-de-cierre'),
              'cerrarTurno': ('cierre-de-turno', 'guardar-cierre-de-turno')}
    if accion not in reglas:
        error(404, 'Operación de Producción no encontrada.')
    pantalla, permiso = reglas[accion]
    exigir(actor, 'produccion/'+pantalla, escribir=True, accion=permiso)
    with db() as cx:
        today = hoy(cx)
        if accion == 'registrarIncidencia':
            linea = catalogo_activo(cx, 'lineas', requerido(datos, 'linea'))
            tipo, severidad = requerido(datos, 'tipo'), requerido(datos, 'severidad')
            if tipo not in {'Material', 'Equipo', 'Calidad', 'Otro'} or severidad not in {'Baja', 'Media', 'Alta'}:
                error(422, 'Tipo o severidad no válidos.')
            rid = ejecutar(cx, '''INSERT INTO incidencias_web(id_usuario,id_linea,tipo,severidad,paro,motivo)
                VALUES (:u,:l,:tipo,:s,:paro,:m) RETURNING id_incidencia''', u=actor['id_usuario'], l=linea['id'],
                tipo=tipo, s=severidad, paro=entero(datos.get('paro', 0), 'paro', 0), m=requerido(datos, 'motivo', 2000)).scalar_one()
            auditar(cx, actor, 'incidencias_web', rid, 'REGISTRAR_INCIDENCIA')
            return {'ok': True, 'id': str(rid)}
        turno = entero(datos.get('turno'), 'turno')
        catalogo_activo(cx, 'turnos', turno)
        orden = None
        if accion in {'registrarUnidad', 'solicitarAjuste'}:
            oid = entero(datos.get('orden'), 'orden')
            orden = next((o for o in ordenes(cx) if o['id_orden'] == oid), None)
            if not orden:
                error(404, 'Orden no encontrada.')
            linea = catalogo_activo(cx, 'lineas', orden['id_linea'])
        else:
            linea = catalogo_activo(cx, 'lineas', requerido(datos, 'linea'))
        bloquear_turno(cx, linea['id'], turno, today)
        cierre = cierre_actual(cx, linea['id'], turno, today)
        if accion == 'registrarUnidad':
            if cierre and cierre['estado'] == 'Cerrado':
                error(409, 'El turno está cerrado. Solicita su reapertura a Gerencia.')
            catalogo_activo(cx, 'modelos', orden['id_modelo'])
            catalogo_activo(cx, 'clientes', orden['id_cliente'])
            serie = requerido(datos, 'serie', 100)
            ejecutar(cx, 'SELECT pg_advisory_xact_lock(hashtextextended(:clave,0))', clave='serie:'+serie.casefold())
            if ejecutar(cx, 'SELECT 1 FROM unidades WHERE upper(numero_serie)=upper(:s)', s=serie).first():
                error(409, 'Ya existe una unidad con ese número de serie.')
            codigo = requerido(datos, 'lote', 100)
            # Bloqueo adicional: el mismo código no puede crearse para órdenes diferentes.
            ejecutar(cx, 'SELECT pg_advisory_xact_lock(hashtextextended(:clave,0))', clave='lote:'+codigo.casefold())
            lote = uno(cx, 'SELECT * FROM lote WHERE lower(codigo)=lower(:c) FOR UPDATE', c=codigo)
            if lote and lote['id_orden'] != orden['id_orden']:
                error(409, 'El lote pertenece a otra orden.')
            if lote:
                lid = lote['id_lote']
                if lote['estado'] not in {'EN_PROCESO', 'ABIERTO'}:
                    error(409, 'El lote no está abierto para registrar producción.')
            else:
                lid = ejecutar(cx, '''INSERT INTO lote(id_orden,cantidad_acordada,estado,codigo,fecha_creacion)
                    VALUES (:o,:n,'EN_PROCESO',:c,''' + AHORA + ') RETURNING id_lote',
                    o=orden['id_orden'], n=orden['cantidad'], c=codigo).scalar_one()
            uid = ejecutar(cx, '''INSERT INTO unidades(id_color,id_linea,id_turno,id_lote,estado,numero_serie,id_usuario_registro,fecha_hora)
                VALUES (:color,:linea,:turno,:lote,'ENSAMBLADA',:serie,:u,''' + AHORA + ') RETURNING id_unidad',
                color=orden['id_color'], linea=linea['id'], turno=turno, lote=lid, serie=serie, u=actor['id_usuario']).scalar_one()
            ejecutar(cx, '''INSERT INTO ensamble(id_usuario,id_turno,id_linea,id_lote,cantidad,fecha_ensamble)
                VALUES (:u,:t,:l,:lo,1,''' + AHORA + ')', u=actor['id_usuario'], t=turno, l=linea['id'], lo=lid)
            auditar(cx, actor, 'unidades', uid, 'REGISTRAR_PRODUCCION', despues={'serie': serie, 'estado': 'ENSAMBLADA'})
            return {'ok': True, 'id': uid, 'serie': serie}
        if accion == 'cerrarTurno':
            if cierre and cierre['estado'] == 'Cerrado':
                error(409, 'Este turno ya está cerrado.')
            nota = requerido(datos, 'motivo', 2000)
            rs = [r for r in metricas(cx, today) if r['linea'] == linea['codigo'] and r['turno'] == turno]
            total = lambda k: sum(r[k] for r in rs)
            if cierre and cierre['origen_web']:
                rid = cierre['id_cierre']
                ejecutar(cx, '''UPDATE cierresturno SET estado='Cerrado',nota=:nota,id_usuario=:u,revision=revision+1,
                    total_reportadas=:n,total_empacadas=:e,total_retenidas=:r,total_retrabajo=:re,total_scrap=:s WHERE id_cierre=:id''',
                    nota=nota, u=actor['id_usuario'], n=total('reportadas'), e=total('recibidas'), r=total('retenidas'), re=total('retrabajo'), s=total('scrap'), id=rid)
            else:
                rid = ejecutar(cx, '''INSERT INTO cierresturno(id_usuario,id_linea,id_turno,fecha,estado,nota,origen_web,
                    total_reportadas,total_empacadas,total_retenidas,total_retrabajo,total_scrap)
                    VALUES (:u,:l,:t,''' + AHORA + ", 'Cerrado',:nota,TRUE,:n,:e,:r,:re,:s) RETURNING id_cierre",
                    u=actor['id_usuario'], l=linea['id'], t=turno, nota=nota,
                    n=total('reportadas'), e=total('recibidas'), r=total('retenidas'), re=total('retrabajo'), s=total('scrap')).scalar_one()
            auditar(cx, actor, 'cierresturno', rid, 'CERRAR_TURNO', nota)
            return {'ok': True}
        tipo = requerido(datos, 'tipo')
        if tipo not in {'Corrección de cierre', 'Reapertura de turno'}:
            error(422, 'Tipo de solicitud no válido.')
        if not cierre or cierre['estado'] != 'Cerrado':
            error(409, 'Primero debe existir un cierre confirmado para ese turno.')
        actual = sum(r['reportadas'] for r in metricas(cx, today) if r['orden'] == orden['id'] and r['turno'] == turno)
        nuevo = entero(datos.get('nuevo'), 'nuevo', 0) if tipo == 'Corrección de cierre' else None
        if nuevo == actual:
            error(422, 'El conteo corregido debe ser diferente al actual.')
        if ejecutar(cx, """SELECT 1 FROM autorizacion WHERE tipo_referencia='PRODUCCION_WEB' AND estado='Pendiente'
                AND datos->>'fechaTurno'=:f AND datos->>'linea'=:l AND datos->>'turno'=:t
                AND datos->>'tipo'=:tipo AND datos->>'orden'=:o""",
                f=today.isoformat(), l=linea['codigo'], t=str(turno), tipo=tipo, o=orden['id']).first():
            error(409, 'Ya hay una solicitud pendiente para esta orden y turno.')
        payload = dict(tipo=tipo, orden=orden['id'], linea=linea['codigo'], idLinea=linea['id'], turno=turno,
            fechaTurno=today.isoformat(), idCierre=cierre['id_cierre'], revisionCierre=cierre['revision'],
            cambio={'campo': 'Reportadas', 'de': actual, 'a': nuevo} if nuevo is not None else None)
        motivo = requerido(datos, 'motivo', 300, 10)
        rid = ejecutar(cx, '''INSERT INTO autorizacion(id_usuario_solicita,id_referencia,tipo_referencia,motivo,estado,datos,fecha_solicitud)
            VALUES (:u,:c,'PRODUCCION_WEB',:m,'Pendiente',CAST(:d AS jsonb),''' + AHORA + ') RETURNING id_autorizacion',
            u=actor['id_usuario'], c=cierre['id_cierre'], m=motivo, d=json.dumps(payload)).scalar_one()
        auditar(cx, actor, 'autorizacion', rid, 'SOLICITAR_AJUSTE', motivo, despues=payload)
        return {'ok': True, 'id': str(rid)}


@router.get('/autorizaciones')
def autorizaciones(actor=Depends(actor_actual)):
    exigir(actor, 'gerencia/autorizaciones')
    with db() as cx:
        lista = solicitudes(cx)
        return {'pendientes': [a for a in lista if a['estado'] == 'Pendiente'], 'resueltas': [a for a in lista if a['estado'] != 'Pendiente']}


@router.post('/autorizaciones/{id}/resolver')
def resolver(id: int, datos: dict, actor=Depends(actor_actual)):
    exigir(actor, 'gerencia/autorizaciones', escribir=True, accion='aprobar-o-rechazar-ajustes-y-reaperturas')
    decision = datos.get('decision')
    if decision not in {'aprobar', 'rechazar'}:
        error(422, 'Decisión no válida.')
    motivo = requerido(datos, 'motivo', 1000) if decision == 'rechazar' else str(datos.get('motivo') or '').strip()[:1000]
    with db() as cx:
        a = uno(cx, "SELECT * FROM autorizacion WHERE id_autorizacion=:id AND tipo_referencia='PRODUCCION_WEB' FOR UPDATE", id=id)
        if not a:
            error(404, 'Solicitud no encontrada.')
        if a['estado'] != 'Pendiente':
            error(409, 'La solicitud ya fue resuelta.')
        if a['id_usuario_solicita'] == actor['id_usuario']:
            error(403, 'La solicitud debe resolverla una persona diferente de quien la creó.')
        d = a['datos']
        fecha = date.fromisoformat(d['fechaTurno'])
        bloquear_turno(cx, d['idLinea'], d['turno'], fecha)
        cierre = cierre_actual(cx, d['idLinea'], d['turno'], fecha)
        if decision == 'aprobar':
            if not cierre or cierre['id_cierre'] != d['idCierre'] or cierre['estado'] != 'Cerrado' or cierre['revision'] != d['revisionCierre']:
                error(409, 'El cierre cambió desde la solicitud. Recházala y solicita una nueva.')
            if d['tipo'] == 'Reapertura de turno':
                ejecutar(cx, "UPDATE cierresturno SET estado='Reabierto',revision=revision+1 WHERE id_cierre=:id", id=cierre['id_cierre'])
                auditar(cx, actor, 'cierresturno', cierre['id_cierre'], 'REABRIR_TURNO', a['motivo'])
            else:
                actual = sum(r['reportadas'] for r in metricas(cx, fecha) if r['orden'] == d['orden'] and r['turno'] == d['turno'])
                if actual != d['cambio']['de']:
                    error(409, 'El conteo cambió. Rechaza esta solicitud y solicita una nueva.')
                ejecutar(cx, '''INSERT INTO ajustes_conteo_web(id_autorizacion,id_orden,id_linea,id_turno,fecha,diferencia)
                    VALUES (:id,:o,:l,:t,:f,:delta)''', id=id, o=int(d['orden']), l=d['idLinea'], t=d['turno'], f=fecha, delta=d['cambio']['a']-actual)
                total = sum(r['reportadas'] for r in metricas(cx, fecha) if r['linea'] == d['linea'] and r['turno'] == d['turno'])
                ejecutar(cx, 'UPDATE cierresturno SET total_reportadas=:n WHERE id_cierre=:id', n=total, id=cierre['id_cierre'])
            # Un ajuste cambia el conteo reportado, nunca inventa series ni liberaciones.
        estado = 'Aprobada' if decision == 'aprobar' else 'Rechazada'
        ejecutar(cx, '''UPDATE autorizacion SET estado=:e,id_usuario_autoriza=:u,
            fecha_autorizacion=''' + AHORA + ',motivo_resolucion=:m WHERE id_autorizacion=:id', e=estado, u=actor['id_usuario'], m=motivo, id=id)
        auditar(cx, actor, 'autorizacion', id, 'RESOLVER_AJUSTE', motivo, despues={'estado': estado})
        return {'ok': True}


def filtrar(filas, turno=None, linea=None, modelo=None, orden=None):
    return [r for r in filas if (not turno or r['turno'] == turno) and (not linea or r['linea'] == linea)
            and (not modelo or r['modelo'] == modelo) and (not orden or r['orden'] == orden)]


@router.get('/dashboard')
def dashboard(turno: int | None = None, linea: str = '', modelo: str = '', orden: str = '', actor=Depends(actor_actual)):
    exigir(actor, 'gerencia/dashboard')
    with db() as cx:
        rs = filtrar(metricas(cx), turno, linea, modelo, orden)
        total = lambda key: sum(r[key] for r in rs)
        meta, reportadas = total('meta'), total('reportadas')
        us = unidades(cx)
        os = []
        for o in ordenes(cx):
            if linea and o['linea'] != linea or modelo and o['modelo'] != modelo or orden and o['id'] != orden:
                continue
            ajuste = ejecutar(cx, 'SELECT COALESCE(SUM(diferencia),0) FROM ajustes_conteo_web WHERE id_orden=:o', o=o['id_orden']).scalar_one()
            n = sum(u['orden'] == o['id'] for u in us) + ajuste
            cajas = todos(cx, 'SELECT estado,count(*) AS cantidad FROM cajas WHERE id_orden=:o GROUP BY estado', o=o['id_orden'])
            cc = {c['estado']: c['cantidad'] for c in cajas}
            compromiso = o['fecha_compromiso']
            estado = 'A tiempo' if n >= o['cantidad'] else 'Atrasada' if compromiso and compromiso < hoy(cx) else 'En riesgo'
            os.append({**o, 'producidas': n, 'faltante': max(o['cantidad']-n, 0), 'avance': n*100/o['cantidad'] if o['cantidad'] else 0,
                'compromiso': compromiso, 'estado': estado, 'cajas': {'preparadas': cc.get('CERRADA', 0), 'pendientes': cc.get('EN_PROCESO', 0), 'embarcadas': cc.get('EMBARCADA', 0)}})
        clientes = {}
        for o in os:
            g = clientes.setdefault(o['cliente'], dict(cliente=o['cliente'], preparadas=0, pendientes=0, embarcadas=0))
            for key, value in o['cajas'].items():
                g[key] += value
        # Datos existentes de Calidad: lectura gerencial; la captura de Calidad sigue sin conectarse.
        defectos = todos(cx, '''SELECT cat.nombre AS categoria,COALESCE(d.nombre,d.causa,'Sin causa registrada') AS defecto,count(*) AS cantidad,
            u.id_turno AS turno,COALESCE(c.codigo,'L'||u.id_linea) AS linea,m.nombre AS modelo,o.id_orden::text AS orden
            FROM defectos d JOIN cat_defectos cat USING(id_categoria) JOIN calidad q USING(id_calidad)
            JOIN unidades u ON u.id_unidad=q.id_unidad JOIN lote l USING(id_lote) JOIN ordenes o USING(id_orden)
            JOIN modelos m USING(id_modelo) LEFT JOIN catalogos_web c ON c.tipo='lineas' AND c.id_original=u.id_linea
            WHERE q.fecha::date=CURRENT_DATE AND q.evento='INSPECCION' GROUP BY cat.nombre,d.nombre,d.causa,u.id_turno,c.codigo,u.id_linea,m.nombre,o.id_orden''')
        return {'resumen': {'meta': meta, 'producidas': reportadas, 'faltante': max(meta-reportadas, 0), 'avance': reportadas*100/meta if meta else 0},
                'disposiciones': {k: total(k) for k in ['liberadas', 'retenidas', 'retrabajo', 'scrap']},
                'defectos': filtrar(defectos, turno, linea, modelo, orden), 'ordenes': os, 'cajasPorCliente': list(clientes.values())}


@router.get('/discrepancias')
def discrepancias(fecha: date | None = None, turno: int | None = None, vista: str = Query('lote', pattern='^(lote|linea|modelo)$'), actor=Depends(actor_actual)):
    exigir(actor, 'gerencia/discrepancias')
    with db() as cx:
        fecha = fecha or hoy(cx)
        rs = [r for r in filtrar(metricas(cx, fecha), turno) if any(r[k] for k in ['reportadas', 'liberadas', 'recibidas'])]
        grupos = defaultdict(list)
        for r in rs:
            grupos[r[vista]].append(r)
        def sumas(filas):
            d = {k: sum(r[k] for r in filas) for k in ['reportadas', 'liberadas', 'recibidas']}
            return dict(**d, noLiberadas=d['reportadas']-d['liberadas'], sinRecibir=d['liberadas']-d['recibidas'])
        filas = [dict(etiqueta=k, linea=v[0]['linea'], modelo=v[0]['modelo'], orden=v[0]['orden'], turno=v[0]['turno'], **sumas(v)) for k, v in grupos.items()]
        totales = sumas(rs)
        return {'fecha': fecha, 'turno': turno, 'vista': vista, 'totales': dict(**totales, diferencia=totales['reportadas']-totales['recibidas']), 'filas': filas}


@router.get('/cierres-turno')
def reporte_cierres(desde: date | None = None, hasta: date | None = None, linea: str = '', turno: int | None = None, actor=Depends(actor_actual)):
    exigir(actor, 'gerencia/cierres-de-turno')
    with db() as cx:
        hasta = hasta or hoy(cx)
        desde = desde or hasta-timedelta(days=6)
        if desde > hasta or (hasta-desde).days > 366:
            error(422, 'Selecciona un intervalo de hasta 366 días en orden cronológico.')
        resultado = []
        cs = cierres(cx)
        fecha = desde
        while fecha <= hasta:
            grupos = defaultdict(list)
            for r in filtrar(metricas(cx, fecha), turno, linea):
                grupos[(r['linea'], r['turno'])].append(r)
            for c in cs:
                if c['fecha'] == fecha.isoformat() and (not linea or c['linea'] == linea) and (not turno or c['turno'] == turno):
                    grupos.setdefault((c['linea'], c['turno']), [])
            for (ln, tr), rs in grupos.items():
                c = next((c for c in reversed(cs) if c['fecha'] == fecha.isoformat() and c['linea'] == ln and c['turno'] == tr), None)
                d = {k: sum(r[k] for r in rs) for k in ['reportadas', 'recibidas', 'retenidas', 'retrabajo', 'scrap']}
                if c and c['estado'] == 'Cerrado':
                    for key, columna in [('reportadas', 'total_reportadas'), ('recibidas', 'total_empacadas'), ('retenidas', 'total_retenidas'), ('retrabajo', 'total_retrabajo'), ('scrap', 'total_scrap')]:
                        if c[columna] is not None:
                            d[key] = c[columna]
                resultado.append(dict(fecha=fecha.isoformat(), linea=ln, turno=tr, estado=c['estado'] if c else 'Sin confirmar', nota=c['nota'] if c else '',
                    reportadas=d['reportadas'], empacadas=d['recibidas'], retenidas=d['retenidas'], retrabajo=d['retrabajo'], scrap=d['scrap'],
                    diferencia=d['reportadas']-d['recibidas'], sinExplicar=d['reportadas']-d['recibidas']-d['retenidas']-d['retrabajo']-d['scrap']))
            fecha += timedelta(days=1)
        return sorted(resultado, key=lambda r: (r['fecha'], r['turno'], r['linea']), reverse=True)


@router.get('/unidades/{serie}')
def trazabilidad(serie: str, actor=Depends(actor_actual)):
    exigir(actor, 'gerencia/trazabilidad')
    return detalle_trazabilidad(serie)


def detalle_trazabilidad(serie):
    with db() as cx:
        u = next((u for u in unidades(cx) if (u['serie'] or '').casefold() == serie.strip().casefold()), None)
        if not u:
            error(404, 'No se encontró esa serie en PostgreSQL.')
        eventos = []
        def evento(fecha, area, accion, resultado, usuario='No registrado'):
            eventos.append(dict(**tiempo(fecha), area=area, evento=accion, resultado=resultado or '', usuario=usuario))
        usuario = uno(cx, 'SELECT nombre FROM usuarios WHERE id_usuario=:id', id=u['id_usuario_registro']) if u['id_usuario_registro'] else None
        evento(u['fecha_hora'], 'Producción', 'Unidad ensamblada', 'ENSAMBLADA', usuario['nombre'] if usuario else 'No registrado')
        for p in todos(cx, 'SELECT p.*,a.nombre AS autor FROM pruebas p LEFT JOIN usuarios a ON a.id_usuario=p.id_usuario WHERE id_unidad=:id ORDER BY fecha,id_prueba', id=u['id_unidad']):
            evento(p['fecha'], 'Prueba funcional', p['detalles_prueba'] or 'Prueba registrada', p['resultado'], p['autor'] or 'No registrado')
        for q in todos(cx, 'SELECT c.*,u.nombre AS usuario FROM calidad c JOIN usuarios u USING(id_usuario) WHERE id_unidad=:id ORDER BY fecha,id_calidad', id=u['id_unidad']):
            evento(q['fecha'], 'Calidad', 'Retención revisada' if q['evento'] == 'RETENCION' else 'Inspección registrada', q['estado'] + (' · ' + q['observaciones'] if q['observaciones'] else ''), q['usuario'])
        for r in todos(cx, 'SELECT r.*,a.nombre AS autor FROM retrabajo r LEFT JOIN usuarios a ON a.id_usuario=r.id_usuario WHERE id_unidad=:id ORDER BY fecha,id_retrabajo', id=u['id_unidad']):
            if r['resultado'] is not None:
                evento(r['fecha_fin'] or r['fecha'], 'Calidad', r['descripcion'] or 'Retrabajo', r['resultado'], r['autor'] or 'No registrado')
        for b in todos(cx, "SELECT b.*,u.nombre AS usuario FROM bitacora_general b JOIN usuarios u USING(id_usuario) WHERE tabla_afectada='unidades' AND id_registro_afectado=:id ORDER BY fecha_hora,id_bitacora", id=u['id_unidad']):
            if b['accion'] == 'REGISTRAR_PRODUCCION' or b['accion'].startswith(('CALIDAD_', 'PRUEBA_')):
                continue
            try:
                datos = json.loads(b['valor_nuevo'] or '{}')
            except ValueError:
                datos = {}
            area = 'Embarques' if 'EMBARQUE' in b['accion'] or 'SALIDA' in b['accion'] else 'Empaque'
            evento(b['fecha_hora'], area, b['accion'].replace('_', ' '), datos.get('estado_nuevo') or b['motivo'], b['usuario'])
        caja = embarque = None
        if u['id_caja']:
            c = uno(cx, 'SELECT * FROM cajas WHERE id_caja=:id', id=u['id_caja'])
            caja = dict(id=str(c['id_caja']), estado={'EN_PROCESO': 'Abierta', 'CERRADA': 'Cerrada', 'EMBARCADA': 'Embarcada'}.get(c['estado'], c['estado']),
                capacidad=c['capacidad'], unidades=[r['numero_serie'] for r in todos(cx, 'SELECT numero_serie FROM unidades WHERE id_caja=:id ORDER BY id_unidad', id=c['id_caja'])])
            if c['id_embarque']:
                e = uno(cx, 'SELECT e.*,c.nombre AS cliente FROM embarques e JOIN clientes c USING(id_cliente) WHERE id_embarque=:id', id=c['id_embarque'])
                embarque = dict(id=str(e['id_embarque']), referencia=e['referencia'], cliente=e['cliente'], fechaSalida=e['fecha_salida'].date().isoformat() if e['fecha_salida'] else None)
        prueba = uno(cx, 'SELECT resultados FROM pruebas WHERE id_unidad=:id ORDER BY fecha DESC,id_prueba DESC LIMIT 1', id=u['id_unidad'])
        return dict(**u, **tiempo(u['fecha_hora']), prueba=(prueba or {}).get('resultados') or {}, historial=sorted(eventos, key=lambda e: (e['fecha'] or '', e['hora'])), caja=caja, embarque=embarque)


class UsuarioGuardar(BaseModel):
    numEmpleado: str = Field(min_length=1, max_length=50)
    nombre: str = Field(min_length=1, max_length=100)
    rol: str = Field(min_length=1, max_length=50)
    estado: str = Field(pattern='^(Activo|Bloqueado|Inactivo)$')
    contrasena: str = Field(default='', max_length=255)


def usuarios_db(cx):
    return todos(cx, '''SELECT u.id_usuario,u.usuario AS "numEmpleado",u.nombre,r.nombre AS rol,
        CASE WHEN NOT u.activo AND u.estado='Activo' THEN 'Inactivo' ELSE u.estado END AS estado
        FROM usuarios u JOIN roles r USING(id_rol) ORDER BY u.id_usuario''')


@router.get('/usuarios')
def usuarios(q: str = '', actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/usuarios')
    with db() as cx:
        return [u for u in usuarios_db(cx) if q.casefold() in f"{u['numEmpleado']} {u['nombre']} {u['rol']}".casefold()]


@router.get('/usuarios/{numero}')
def usuario(numero: str, actor=Depends(actor_actual)):
    exigir_alguna(actor, ['sistemas/usuarios', 'sistemas/nuevo-o-editar-usuario'])
    with db() as cx:
        u = next((u for u in usuarios_db(cx) if u['numEmpleado'] == numero), None)
        if not u:
            error(404, 'Usuario no encontrado.')
        return u


def guardar_usuario(datos, actor, *, numero=None):
    exigir(actor, 'sistemas/nuevo-o-editar-usuario', escribir=True, accion=ADMINISTRAR)
    d = datos.model_dump()
    d['numEmpleado'], d['nombre'] = d['numEmpleado'].strip(), d['nombre'].strip()
    if not d['nombre'] or not re.fullmatch(r'[\w.@-]{1,50}', d['numEmpleado']):
        error(422, 'Nombre y número de empleado o usuario no válidos.')
    if numero is not None and numero != d['numEmpleado']:
        error(422, 'No se puede cambiar el identificador de acceso.')
    if d['contrasena'] and len(d['contrasena']) < 8:
        error(422, 'La contraseña debe tener al menos 8 caracteres.')
    with db() as cx:
        ejecutar(cx, "SELECT pg_advisory_xact_lock(hashtextextended('administracion-usuarios-roles',0))")
        actual = uno(cx, 'SELECT * FROM usuarios WHERE usuario=:n FOR UPDATE', n=d['numEmpleado'])
        if numero is None and actual:
            error(409, 'Ya existe un usuario con ese identificador.')
        if numero is not None and not actual:
            error(404, 'Usuario no encontrado.')
        rol = uno(cx, 'SELECT * FROM roles WHERE nombre=:n ORDER BY id_rol LIMIT 1', n=d['rol'])
        if not rol:
            error(422, 'Rol no encontrado.')
        if actual and actual['id_usuario'] == actor['id_usuario'] and (d['estado'] != 'Activo' or rol['id_rol'] != actual['id_rol']):
            error(409, 'No puedes bloquearte ni cambiar tu propio rol desde esta sesión.')
        # Mantener al menos un administrador activo con acceso a Sistemas.
        if actual:
            administradores = todos(cx, """SELECT u.id_usuario FROM usuarios u JOIN roles r USING(id_rol)
                WHERE u.activo AND u.estado='Activo' AND r.permisos->>'sistemas/nuevo-o-editar-usuario'='acciona'
                AND r.acciones @> CAST(:a AS jsonb)""", a=json.dumps([ADMINISTRAR]))
            conserva = d['estado'] == 'Activo' and (rol['permisos'] or {}).get('sistemas/nuevo-o-editar-usuario') == 'acciona' and ADMINISTRAR in (rol['acciones'] or [])
            if [a['id_usuario'] for a in administradores] == [actual['id_usuario']] and not conserva:
                error(409, 'Debe permanecer al menos un administrador activo.')
            ejecutar(cx, '''UPDATE usuarios SET nombre=:nombre,id_rol=:rol,estado=:estado,activo=:activo,
                contrasena=COALESCE(:password,contrasena) WHERE id_usuario=:id''', nombre=d['nombre'], rol=rol['id_rol'],
                estado=d['estado'], activo=d['estado'] == 'Activo', password=hash_password(d['contrasena']) if d['contrasena'] else None, id=actual['id_usuario'])
            uid = actual['id_usuario']
            if d['contrasena'] or d['estado'] != 'Activo' or rol['id_rol'] != actual['id_rol']:
                ejecutar(cx, 'DELETE FROM sesiones_web WHERE id_usuario=:id', id=uid)
        else:
            if not d['contrasena']:
                error(422, 'La contraseña es obligatoria para crear un usuario.')
            uid = ejecutar(cx, '''INSERT INTO usuarios(id_rol,nombre,usuario,contrasena,estado,activo)
                VALUES (:rol,:nombre,:numero,:password,:estado,:activo) RETURNING id_usuario''',
                rol=rol['id_rol'], nombre=d['nombre'], numero=d['numEmpleado'], password=hash_password(d['contrasena']), estado=d['estado'], activo=d['estado'] == 'Activo').scalar_one()
        auditar(cx, actor, 'usuarios', uid, 'GUARDAR_USUARIO', despues={k: v for k, v in d.items() if k != 'contrasena'})
        return {'ok': True}


@router.post('/usuarios', status_code=201)
def crear_usuario(datos: UsuarioGuardar, actor=Depends(actor_actual)):
    return guardar_usuario(datos, actor)


@router.put('/usuarios/{numero}')
def editar_usuario(numero: str, datos: UsuarioGuardar, actor=Depends(actor_actual)):
    return guardar_usuario(datos, actor, numero=numero)


@router.get('/roles')
def roles(actor=Depends(actor_actual)):
    exigir_alguna(actor, ['sistemas/roles-y-permisos', 'sistemas/nuevo-o-editar-usuario', 'sistemas/usuarios'])
    with db() as cx:
        return {**CONTRATOS, 'roles': todos(cx, 'SELECT nombre,descripcion,permisos,acciones FROM roles ORDER BY id_rol')}


class RolGuardar(BaseModel):
    permisos: dict[str, str]
    acciones: list[str]


@router.put('/roles/{nombre}')
def guardar_rol(nombre: str, datos: RolGuardar, actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/roles-y-permisos', escribir=True, accion=ADMINISTRAR)
    if set(datos.permisos) - PANTALLAS - {'login/login', 'login/levantar-ticket'} or any(v not in {'ver', 'acciona'} for v in datos.permisos.values()) or set(datos.acciones)-ACCIONES:
        error(422, 'Pantallas, niveles o acciones no válidos.')
    with db() as cx:
        ejecutar(cx, "SELECT pg_advisory_xact_lock(hashtextextended('administracion-usuarios-roles',0))")
        rol = uno(cx, 'SELECT * FROM roles WHERE nombre=:n ORDER BY id_rol LIMIT 1 FOR UPDATE', n=nombre)
        if not rol:
            error(404, 'Rol no encontrado.')
        if actor['rol'] == nombre or nombre == 'Administrador':
            if any(datos.permisos.get(p) != 'acciona' for p in SISTEMAS) or ADMINISTRAR not in datos.acciones:
                error(409, 'Conserva el acceso administrativo a Sistemas para evitar perder la administración.')
        ejecutar(cx, 'UPDATE roles SET permisos=CAST(:p AS jsonb),acciones=CAST(:a AS jsonb) WHERE id_rol=:id',
            p=json.dumps(datos.permisos), a=json.dumps(datos.acciones), id=rol['id_rol'])
        auditar(cx, actor, 'roles', rol['id_rol'], 'GUARDAR_PERMISOS', despues=datos.model_dump())
        return {'ok': True}


@router.get('/catalogos')
def catalogos(actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/catalogos')
    with db() as cx:
        return leer_catalogos(cx)


class ElementoCatalogo(BaseModel):
    codigo: str = Field(min_length=1, max_length=100)
    nombre: str = Field(min_length=1, max_length=100)
    estado: str = Field(default='Activo', pattern='^(Activo|Inactivo)$')


@router.post('/catalogos/{tipo}', status_code=201)
def crear_elemento(tipo: str, datos: ElementoCatalogo, actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/catalogos', escribir=True, accion=ADMINISTRAR)
    if tipo not in CATALOGOS:
        error(404, 'Catálogo no encontrado.')
    codigo, nombre = datos.codigo.strip(), datos.nombre.strip()
    if not codigo or not nombre:
        error(422, 'Código y nombre son obligatorios.')
    if tipo == 'lineas' and len(nombre) > 20 or tipo in {'modelos', 'categorias'} and len(nombre) > 50:
        error(422, 'El nombre excede el tamaño permitido por el catálogo.')
    with db() as cx:
        ejecutar(cx, "SELECT pg_advisory_xact_lock(hashtextextended('catalogos-configuracion',0))")
        if any(i['codigo'].casefold() == codigo.casefold() for i in leer_catalogos(cx)[tipo]['items']):
            error(409, 'Ya existe ese código en el catálogo.')
        rid = None
        if tipo == 'turnos':
            # El código de turno es el ID usado por órdenes y unidades.
            rid = entero(codigo, 'Código de turno')
            ejecutar(cx, 'INSERT INTO turnos(id_turno) VALUES (:id)', id=rid)
            ejecutar(cx, "SELECT setval(pg_get_serial_sequence('turnos','id_turno'),(SELECT max(id_turno) FROM turnos))")
        elif tipo == 'clientes':
            rid = ejecutar(cx, 'INSERT INTO clientes(nombre,mezcla_colores) VALUES (:n,FALSE) RETURNING id_cliente', n=nombre).scalar_one()
        elif tipo in {'modelos', 'lineas', 'categorias'}:
            tabla, pk, _ = CATALOGOS[tipo]
            if tipo == 'modelos' and codigo != nombre:
                error(422, 'Para modelos, usa el código oficial también como nombre (por ejemplo NS-MINI).')
            rid = ejecutar(cx, f'INSERT INTO {tabla}(nombre) VALUES (:n) RETURNING {pk}', n=nombre).scalar_one()
        ejecutar(cx, 'INSERT INTO catalogos_web(tipo,codigo,nombre,activo,id_original) VALUES (:t,:c,:n,:a,:id)',
            t=tipo, c=codigo, n=nombre, a=datos.estado == 'Activo', id=rid)
        if tipo == 'modelos':
            # Un modelo nuevo debe configurar su capacidad antes de empacar.
            ejecutar(cx, "UPDATE configuracion_web SET valor=valor || jsonb_build_object(CAST(:m AS text),0) WHERE clave='capacidadCaja'", m=nombre)
        auditar(cx, actor, 'catalogos_web', rid, 'CREAR_CATALOGO', despues={'tipo': tipo, 'codigo': codigo, 'nombre': nombre})
        return {'ok': True}


class EstadoCatalogo(BaseModel):
    estado: str = Field(pattern='^(Activo|Inactivo)$')


@router.patch('/catalogos/{tipo}/{codigo}')
def cambiar_catalogo(tipo: str, codigo: str, datos: EstadoCatalogo, actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/catalogos', escribir=True, accion=ADMINISTRAR)
    if tipo not in CATALOGOS:
        error(404, 'Catálogo no encontrado.')
    with db() as cx:
        item = next((i for i in leer_catalogos(cx)[tipo]['items'] if i['codigo'] == codigo), None)
        if not item:
            error(404, 'Elemento no encontrado.')
        ejecutar(cx, '''INSERT INTO catalogos_web(tipo,codigo,nombre,activo,id_original) VALUES (:t,:c,:n,:a,:id)
            ON CONFLICT(tipo,codigo) DO UPDATE SET activo=excluded.activo''', t=tipo, c=codigo, n=item['nombre'], a=datos.estado == 'Activo', id=item.get('id'))
        auditar(cx, actor, 'catalogos_web', item.get('id'), 'ESTADO_CATALOGO', despues={'tipo': tipo, 'codigo': codigo, 'estado': datos.estado})
        return {'ok': True}


@router.get('/parametros')
def parametros(actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/parametros')
    with db() as cx:
        p = uno(cx, "SELECT c.*,u.nombre FROM configuracion_web c LEFT JOIN usuarios u USING(id_usuario) WHERE clave='capacidadCaja'")
        return {'capacidadCaja': p['valor'], 'ultimoCambio': dict(por=p['nombre'] or 'Configuración inicial', motivo=p['motivo'], **tiempo(p['fecha']))}


class ParametrosGuardar(BaseModel):
    capacidadCaja: dict[str, StrictInt]
    motivo: str = Field(min_length=1, max_length=500)


@router.put('/parametros')
def guardar_parametros(datos: ParametrosGuardar, actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/parametros', escribir=True, accion=ADMINISTRAR)
    if not datos.motivo.strip() or not datos.capacidadCaja or any(not 1 <= v <= 999 for v in datos.capacidadCaja.values()):
        error(422, 'Capacidades enteras de 1 a 999 y motivo son obligatorios.')
    with db() as cx:
        ejecutar(cx, "SELECT pg_advisory_xact_lock(hashtextextended('catalogos-configuracion',0))")
        anterior = uno(cx, "SELECT valor FROM configuracion_web WHERE clave='capacidadCaja' FOR UPDATE")['valor']
        if set(datos.capacidadCaja) != set(anterior):
            error(409, 'El catálogo de modelos cambió. Recarga Parámetros.')
        # Cajas abiertas conservan la capacidad con la que fueron creadas; nuevas cajas usan el nuevo valor.
        ejecutar(cx, 'UPDATE configuracion_web SET valor=CAST(:v AS jsonb),id_usuario=:u,fecha='+AHORA+",motivo=:m WHERE clave='capacidadCaja'",
            v=json.dumps(datos.capacidadCaja), u=actor['id_usuario'], m=datos.motivo.strip())
        for modelo, valor in datos.capacidadCaja.items():
            if anterior.get(modelo) != valor:
                auditar(cx, actor, 'configuracion_web', None, 'CAMBIAR_CAPACIDAD', datos.motivo, antes={modelo: anterior.get(modelo)}, despues={modelo: valor})
        return {'ok': True}


class TicketCrear(BaseModel):
    numEmpleado: str = Field(min_length=1, max_length=50)
    nombre: str = Field(min_length=1, max_length=100)
    motivo: str = Field(min_length=1, max_length=2000)


@router.post('/tickets', status_code=201)
def levantar_ticket(datos: TicketCrear):
    if not all(v.strip() for v in datos.model_dump().values()):
        error(422, 'Completa todos los datos del ticket.')
    with db() as cx:
        rid = ejecutar(cx, 'INSERT INTO tickets_web(num_empleado,nombre,motivo) VALUES (:n,:nombre,:m) RETURNING id_ticket',
            n=datos.numEmpleado.strip(), nombre=datos.nombre.strip(), m=datos.motivo.strip()).scalar_one()
        return {'id': 'T-'+str(rid).zfill(4)}


def tickets_db(cx):
    filas = todos(cx, 'SELECT * FROM tickets_web ORDER BY (estado=\'Abierto\') DESC,id_ticket DESC')
    return [dict(id='T-'+str(t['id_ticket']).zfill(4), numEmpleado=t['num_empleado'], nombre=t['nombre'], motivo=t['motivo'],
        estado=t['estado'], comentarios=t['comentarios'], **tiempo(t['fecha'])) for t in filas]


@router.get('/tickets')
def tickets(actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/area-de-tickets')
    with db() as cx:
        return tickets_db(cx)


@router.get('/tickets/{id}')
def ticket(id: str, actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/ver-ticket')
    with db() as cx:
        t = next((t for t in tickets_db(cx) if t['id'] == id), None)
        if not t:
            error(404, 'Ticket no encontrado.')
        return t


@router.post('/tickets/{id}/cerrar')
def cerrar_ticket(id: str, datos: dict, actor=Depends(actor_actual)):
    exigir(actor, 'sistemas/ver-ticket', escribir=True, accion=ADMINISTRAR)
    comentarios = requerido(datos, 'comentarios', 2000)
    with db() as cx:
        if not re.fullmatch(r'T-\d+', id):
            error(404, 'Ticket no encontrado.')
        rid = int(id[2:])
        t = uno(cx, 'SELECT * FROM tickets_web WHERE id_ticket=:id FOR UPDATE', id=rid)
        if not t:
            error(404, 'Ticket no encontrado.')
        if t['estado'] != 'Abierto':
            error(409, 'El ticket ya está cerrado.')
        ejecutar(cx, "UPDATE tickets_web SET estado='Cerrado',comentarios=:c,id_usuario_cierre=:u,fecha_cierre="+AHORA+' WHERE id_ticket=:id',
            c=comentarios, u=actor['id_usuario'], id=rid)
        auditar(cx, actor, 'tickets_web', rid, 'CERRAR_TICKET', comentarios)
        return {'ok': True}
