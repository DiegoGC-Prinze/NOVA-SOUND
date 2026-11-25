"""Pruebas funcionales: cuatro evaluaciones, historial e identidad real."""
import json
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, ConfigDict
from app.core.acceso import actor_actual, exigir, exigir_alguna
from app.modules import gestion as g
from app.modules.calidad import repository as r

router = APIRouter(prefix='/api/v1/pruebas',tags=['Pruebas funcionales'])
PANTALLAS = ['prueba-funcional/'+p for p in ['escanear-pieza-o-lote','registro-de-pruebas-funcionales','unidades-por-probar','historial-de-pruebas']]


class ResultadoCrear(BaseModel):
    model_config = ConfigDict(extra='forbid')
    serie: str = Field(min_length=1,max_length=100)
    prueba: dict[str,Literal['Aprobada','Falla']]
    observaciones: str = Field(default='',max_length=2000)


@router.get('/operacion')
def operacion(actor=Depends(actor_actual)):
    exigir_alguna(actor,PANTALLAS)
    with g.db() as cx:
        pruebas = r.todos(cx,'''SELECT p.*,u.numero_serie AS serie,COALESCE(a.nombre,'No registrado') AS usuario
            FROM pruebas p JOIN unidades u USING(id_unidad) LEFT JOIN usuarios a ON a.id_usuario=p.id_usuario
            ORDER BY p.fecha,p.id_prueba''')
        por_unidad = {}
        for p in pruebas:
            por_unidad[p['id_unidad']] = p
        unidades = [dict(u,**g.tiempo(u['fecha_hora']),prueba=(por_unidad.get(u['id_unidad']) or {}).get('resultados') or {},historial=[])
                    for u in g.unidades(cx)]
        meta = {u['id_unidad']:u for u in unidades}
        historial = [dict(meta[p['id_unidad']],**g.tiempo(p['fecha']),usuario=p['usuario'],prueba=p['resultados'] or {},
            resultado='Aprobada' if p['resultado'] in {'APROBADO','APROBADA','Aprobada'} else 'Rechazada',observaciones=p['observaciones']) for p in pruebas]
        return {'real':True,'unidades':unidades,'pruebas':historial,
                'parametros':{'capacidadCaja':{m['nombre']:0 for m in g.leer_catalogos(cx)['modelos']['items']}}}


@router.get('/vista/{vista}')
def vista_operacion(
    vista: Literal["escanear-pieza-o-lote", "registro-de-pruebas-funcionales", "unidades-por-probar", "historial-de-pruebas"],
    consulta: str = '', serie: str = '', modelo: str = '', estado: str = '',
    desde: date | None = None, hasta: date | None = None,
    pagina: int = Query(1, ge=1), limite: int = Query(100, ge=1, le=1000),
    actor=Depends(actor_actual),
):
    exigir(actor, f'prueba-funcional/{vista}')
    relacion = """FROM unidades u JOIN lote l USING (id_lote) JOIN ordenes o USING (id_orden)
        JOIN modelos m USING (id_modelo) JOIN clientes cl USING (id_cliente)
        JOIN colores co ON co.id_color=u.id_color LEFT JOIN catalogos_web cat
        ON cat.tipo='lineas' AND cat.id_original=u.id_linea"""
    historial = vista == 'historial-de-pruebas'
    cola = vista == 'unidades-por-probar'
    params = dict(consulta=consulta, serie=serie, modelo=modelo, estado=estado, desde=desde, hasta=hasta,
                  limite=limite, offset=(pagina - 1) * limite)
    columnas = """u.numero_serie AS serie,COALESCE(l.codigo,'L-'||l.id_lote) AS lote, u.estado,
        l.id_orden::text AS orden,cl.nombre AS cliente,m.nombre AS modelo,co.nombre AS color,
        COALESCE(cat.codigo,'L'||u.id_linea) AS linea,u.id_turno AS turno"""
    if historial:
        relacion += """ JOIN pruebas p USING (id_unidad) LEFT JOIN usuarios a ON a.id_usuario=p.id_usuario
            CROSS JOIN LATERAL (SELECT CASE WHEN p.resultado IN ('APROBADO','APROBADA','Aprobada')
                THEN 'Aprobada' ELSE 'Rechazada' END AS resultado) resultado_prueba"""
        columnas += """, p.fecha AS instante,resultado_prueba.resultado,
            COALESCE(a.nombre,'No registrado') AS usuario,p.observaciones"""
        filtros = """(:estado='' OR resultado_prueba.resultado=:estado)
            AND (CAST(:desde AS date) IS NULL OR p.fecha >= CAST(:desde AS date))
            AND (CAST(:hasta AS date) IS NULL OR p.fecha < CAST(:hasta AS date) + 1)"""
        orden = 'p.fecha DESC,p.id_prueba DESC'
    else:
        columnas += ", u.fecha_hora AS instante"
        orden = 'u.fecha_hora DESC,u.id_unidad DESC'
        if cola:
            filtros = "u.estado IN ('ENSAMBLADA','FALLA_FUNCIONAL') AND (:estado='' OR u.estado=:estado)"
        else:
            filtros = ":consulta<>'' AND upper(u.numero_serie)=upper(:consulta)"
            if vista == 'escanear-pieza-o-lote':
                filtros = f"({filtros} OR (:consulta<>'' AND upper(COALESCE(l.codigo,'L-'||l.id_lote))=upper(:consulta)))"
    if historial or cola:
        filtros += """ AND (:modelo='' OR m.nombre=:modelo) AND
            (:serie='' OR strpos(lower(COALESCE(u.numero_serie,'')||' '||COALESCE(l.codigo,'L-'||l.id_lote)), lower(:serie)) > 0)"""
    with g.db() as cx:
        filas = r.todos(cx, f'SELECT {columnas},count(*) OVER() AS total {relacion} WHERE {filtros} '
                       f'ORDER BY {orden} LIMIT :limite OFFSET :offset', **params)
        total = filas[0]['total'] if filas else 0
        for fila in filas:
            fila.update(g.tiempo(fila.pop('instante')))
            fila.pop('total')
        if vista == 'registro-de-pruebas-funcionales' and filas:
            prueba = r.uno(cx, """SELECT p.resultados FROM pruebas p JOIN unidades u USING(id_unidad)
                WHERE u.numero_serie=:serie ORDER BY p.fecha DESC,p.id_prueba DESC LIMIT 1""", serie=filas[0]['serie'])
            filas[0]['prueba'] = (prueba or {}).get('resultados') or {}
        resumen = g.uno(cx, """SELECT
            (SELECT count(*) FROM pruebas WHERE resultado IN ('APROBADO','APROBADA','Aprobada')) AS aprobadas,
            (SELECT count(*) FROM unidades WHERE estado='FALLA_FUNCIONAL') AS fallas""") if historial or cola else {}
        return {'real': True, 'unidades': [] if historial else filas, 'pruebas': filas if historial else [],
                'total': total, 'pagina': pagina, 'limite': limite, 'resumen': resumen,
                'parametros': {'capacidadCaja': {m['nombre']: 0 for m in g.leer_catalogos(cx)['modelos']['items']}}}


@router.post('/resultado')
def guardar(datos: ResultadoCrear, actor=Depends(actor_actual)):
    exigir(actor,'prueba-funcional/registro-de-pruebas-funcionales',escribir=True,accion='registrar-resultado-de-prueba-funcional')
    if set(datos.prueba) != {'encendido','audio','carga','bluetooth'}:
        g.error(422,'Evalúa las cuatro pruebas antes de guardar.')
    falla = 'Falla' in datos.prueba.values()
    if falla and not datos.observaciones.strip():
        g.error(422,'Describe las fallas en las observaciones.')
    with g.db() as cx:
        u = r.obtener_unidad_por_serie(cx,datos.serie,True)
        if not u:
            g.error(404,'La unidad no existe en PostgreSQL.')
        if u['estado'] not in {'ENSAMBLADA','FALLA_FUNCIONAL'} or u['id_caja'] is not None:
            g.error(409,'La unidad ya fue probada o no está disponible para prueba funcional.')
        estado = 'FALLA_FUNCIONAL' if falla else 'PROBADA'
        pid = r.ejecutar(cx,'''INSERT INTO pruebas(id_unidad,resultado,resultados,observaciones,id_usuario,fecha)
            VALUES (:id,:r,CAST(:resultados AS jsonb),:obs,:a,'''+g.AHORA+') RETURNING id_prueba',
            id=u['id_unidad'],r='RECHAZADO' if falla else 'APROBADO',resultados=json.dumps(datos.prueba),
            obs=datos.observaciones.strip(),a=actor['id_usuario']).scalar_one()
        r.ejecutar(cx,'UPDATE unidades SET estado=:e WHERE id_unidad=:id',e=estado,id=u['id_unidad'])
        g.auditar(cx,actor,'unidades',u['id_unidad'],'PRUEBA_FUNCIONAL',datos.observaciones,
            antes={'estado':u['estado']},despues={'estado':estado,'id_prueba':pid})
        return {'ok':True,'estado':estado}
