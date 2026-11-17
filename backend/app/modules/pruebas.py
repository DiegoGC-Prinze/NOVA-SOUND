"""Pruebas funcionales: cuatro evaluaciones, historial e identidad real."""
import json
from typing import Literal
from fastapi import APIRouter, Depends
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
