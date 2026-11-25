"""API de apoyo para simular historial. NUNCA se activa sin NOVA_SIMULATION_MODE=1.

Solo prepara ordenes y reasigna las fechas de OPERACIONES YA VALIDADAS por las
APIs normales. No inventa estados de unidad, ni inspecciones, ni cierres.
"""
from __future__ import annotations

import hmac
import os
import re
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.acceso import actor_actual
from app.db.database import engine

router = APIRouter(prefix='/api/v1/simulacion', tags=['Simulacion aislada'])
RUN_PATTERN = r'^SIM-[0-9]{4,16}$'


def protegido(actor=Depends(actor_actual), x_simulation_key: str = Header(default='', alias='X-Simulation-Key')):
    if os.getenv('NOVA_SIMULATION_MODE') != '1' or not os.getenv('DB_NAME','').endswith('_simulacion'):
        raise HTTPException(404, 'Simulacion no disponible en este entorno')
    esperado = os.getenv('NOVA_SIMULATION_KEY', '')
    if not esperado or not hmac.compare_digest(esperado, x_simulation_key):
        raise HTTPException(403, 'Clave de simulacion invalida')
    if actor['rol'] not in {'Sistemas','Administrador'}:
        raise HTTPException(403, 'El modulo de simulacion requiere rol Sistemas o Administrador')
    return actor


def tablas(cx):
    cx.execute(text('''CREATE TABLE IF NOT EXISTS sim_ordenes (
        run_id text NOT NULL, id_linea integer NOT NULL REFERENCES linea(id_linea),
        id_modelo integer NOT NULL REFERENCES modelos(id_modelo),
        id_orden integer NOT NULL UNIQUE REFERENCES ordenes(id_orden),
        PRIMARY KEY(run_id,id_linea,id_modelo)
    )'''))
    cx.execute(text('''CREATE TABLE IF NOT EXISTS sim_turnos (
        run_id text NOT NULL, fecha date NOT NULL, id_linea integer NOT NULL,
        id_turno integer NOT NULL, n_unidades integer NOT NULL,
        n_cajas integer NOT NULL, n_embarques integer NOT NULL,
        PRIMARY KEY(run_id,fecha,id_linea,id_turno)
    )'''))


class OrdenCrear(BaseModel):
    run_id: str = Field(pattern=RUN_PATTERN)
    linea: str = Field(pattern=r'^L[1-9][0-9]*$')
    modelo: str = Field(pattern=r'^NS-[A-Z]+$')
    cantidad: int = Field(ge=1,le=1000000)
    fecha_compromiso: date


class ObjetivosCrear(BaseModel):
    run_id: str = Field(pattern=RUN_PATTERN)
    fecha: date
    linea: str = Field(pattern=r'^L[1-9][0-9]*$')
    turno: int = Field(ge=1,le=5)
    metas: dict[str,int] = Field(min_length=1,max_length=20)


@router.post('/objetivos',status_code=201)
def registrar_objetivos(datos: ObjetivosCrear,actor=Depends(protegido)):
    if not date(2020,1,1) <= datos.fecha <= datetime.now().date()+timedelta(days=1):
        raise HTTPException(422,'Fecha fuera de ventana historica permitida')
    if any(v<0 or v>100000 for v in datos.metas.values()):
        raise HTTPException(422,'Cantidad objetivo fuera de rango')
    linea=numero_linea(datos.linea)
    with engine.begin() as cx:
        tablas(cx)
        ordenes=dict(cx.execute(text('''SELECT m.nombre,so.id_orden FROM sim_ordenes so
            JOIN modelos m ON m.id_modelo=so.id_modelo WHERE so.run_id=:r AND so.id_linea=:l'''),
            {'r':datos.run_id,'l':linea}).all())
        if not set(datos.metas).issubset(ordenes):
            raise HTTPException(409,'Se requieren ordenes de simulacion validas')
        turno=cx.execute(text('SELECT id_turno FROM turnos WHERE id_turno=:t'),{'t':datos.turno}).scalar_one_or_none()
        if not turno:
            raise HTTPException(422,'Turno inexistente')
        existencia=dict(cx.execute(text('''SELECT m.nombre,o.cantidad_objetivo FROM objetivo_unidades o
             JOIN sim_ordenes so ON so.id_orden=o.id_orden
             JOIN modelos m ON m.id_modelo=so.id_modelo
             WHERE so.run_id=:r AND o.id_linea=:l AND o.id_turno=:t AND o.fecha=:f'''),
             dict(r=datos.run_id,l=linea,t=datos.turno,f=datos.fecha)).all())
        if existencia:
            if existencia!=datos.metas:
                raise HTTPException(409,'Las metas ya existen con otros valores')
            return {'ok':True,'ya_existian':True,'metas':existencia}
        for modelo,n in datos.metas.items():
            cx.execute(text('''INSERT INTO objetivo_unidades(id_orden,id_linea,id_turno,cantidad_objetivo,fecha)
                VALUES (:o,:l,:t,:n,:f)'''),dict(o=ordenes[modelo],l=linea,t=datos.turno,n=n,f=datos.fecha))
        return {'ok':True,'ya_existian':False,'metas':datos.metas}


class TurnoConsolidar(BaseModel):
    run_id: str = Field(pattern=RUN_PATTERN)
    fecha: date
    linea: str = Field(pattern=r'^L[1-9][0-9]*$')
    turno: int = Field(ge=1,le=5)
    series: list[str] = Field(default_factory=list,max_length=2000)
    cajas: list[int] = Field(default_factory=list,max_length=500)
    embarques: list[int] = Field(default_factory=list,max_length=200)
    incidencias: list[int] = Field(default_factory=list,max_length=100)
    cierre_id: int | None = Field(default=None,gt=0)


def numero_linea(cadena: str) -> int:
    return int(cadena[1:])


def exigir_distintos(valores, nombre):
    if len(valores) != len(set(valores)):
        raise HTTPException(422, f'{nombre} contiene identificadores repetidos')


def ids_verificados(cx, sql, datos, ids, nombre):
    if not ids:
        return []
    reales = list(cx.execute(text(sql),datos).scalars())
    if set(reales) != set(ids) or len(reales) != len(ids):
        raise HTTPException(409,f'{nombre}: hay IDs ajenos al lote, linea o ambiente simulado')
    return reales


@router.get('/estado')
def estado(actor=Depends(protegido)):
    return {'modo':'simulacion_aislada','db':os.getenv('DB_NAME'), 'servidor':'NOVA SOUND',
            'permite_fechas_historicas':True}


@router.post('/ordenes', status_code=201)
def crear_orden(datos: OrdenCrear, actor=Depends(protegido)):
    with engine.begin() as cx:
        tablas(cx)
        linea = numero_linea(datos.linea)
        modelo = cx.execute(text('SELECT id_modelo FROM modelos WHERE nombre=:n'), {'n':datos.modelo}).scalar_one_or_none()
        existe_linea = cx.execute(text('SELECT id_linea FROM linea WHERE id_linea=:l'), {'l':linea}).scalar_one_or_none()
        if modelo is None or existe_linea is None:
            raise HTTPException(422,'El modelo o la linea no existen en el catalogo')
        previa = cx.execute(text('''SELECT id_orden FROM sim_ordenes
            WHERE run_id=:r AND id_linea=:l AND id_modelo=:m'''),
            {'r':datos.run_id,'l':linea,'m':modelo}).scalar_one_or_none()
        if previa:
            return {'id_orden':previa,'modelo':datos.modelo,'linea':datos.linea,'ya_existia':True}
        cliente = cx.execute(text('SELECT id_cliente FROM clientes ORDER BY id_cliente LIMIT 1')).scalar_one()
        color = cx.execute(text('SELECT id_color FROM colores ORDER BY id_color LIMIT 1')).scalar_one()
        orden = cx.execute(text('''INSERT INTO ordenes(id_cliente,id_modelo,id_color,id_linea,cantidad,fecha_compromiso,fecha_inicio)
            VALUES (:c,:m,:co,:l,:q,:f,CAST(:fi AS timestamp)) RETURNING id_orden'''),
            dict(c=cliente,m=modelo,co=color,l=linea,q=datos.cantidad,f=datos.fecha_compromiso,fi=datos.fecha_compromiso-timedelta(days=40))).scalar_one()
        cx.execute(text('''INSERT INTO sim_ordenes(run_id,id_linea,id_modelo,id_orden)
            VALUES (:r,:l,:m,:o)'''),{'r':datos.run_id,'l':linea,'m':modelo,'o':orden})
        return {'id_orden':orden,'modelo':datos.modelo,'linea':datos.linea,'ya_existia':False}


@router.get('/progreso/{run_id}')
def progreso(run_id: str, actor=Depends(protegido)):
    if not re.fullmatch(RUN_PATTERN,run_id):
        raise HTTPException(422,'Run ID invalido')
    with engine.begin() as cx:
        tablas(cx)
        filas = cx.execute(text('''SELECT fecha,id_linea,id_turno,n_unidades,n_cajas,n_embarques
            FROM sim_turnos WHERE run_id=:r ORDER BY fecha,id_linea,id_turno'''),{'r':run_id}).mappings().all()
        return {'run_id':run_id,'turnos':[dict(fecha=f['fecha'].isoformat(),linea='L'+str(f['id_linea']),
            turno=f['id_turno'],unidades=f['n_unidades'],cajas=f['n_cajas'],embarques=f['n_embarques']) for f in filas]}


@router.post('/consolidar-turno')
def consolidar(datos: TurnoConsolidar, actor=Depends(protegido)):
    # Solo la base aislada puede incluir una fecha futura de hasta 1 dia.
    hoy = datetime.now().date()
    if not date(2020,1,1) <= datos.fecha <= hoy + timedelta(days=1):
        raise HTTPException(422,'La fecha simulada solo puede llegar hasta manana')
    linea = numero_linea(datos.linea)
    for nombre, ids in [('series',datos.series),('cajas',datos.cajas),
                        ('embarques',datos.embarques),('incidencias',datos.incidencias)]:
        exigir_distintos(ids,nombre)
    if any(not re.fullmatch(re.escape(datos.run_id)+r'-[0-9]{6}',s) for s in datos.series):
        raise HTTPException(422,'Se encontraron numeros de serie fuera del run_id')
    # Marcas temporales causales dentro de un turno de ocho horas.
    t0 = datetime.combine(datos.fecha, time(7 if datos.turno == 1 else 15,0))
    tpr = t0 + timedelta(minutes=20)
    tcal = t0 + timedelta(minutes=40)
    tcaja = t0 + timedelta(hours=3)
    temb = t0 + timedelta(hours=4)
    tfin = t0 + timedelta(hours=7,minutes=30)
    with engine.begin() as cx:
        tablas(cx)
        previo = cx.execute(text('''SELECT n_unidades,n_cajas,n_embarques FROM sim_turnos
             WHERE run_id=:r AND fecha=:f AND id_linea=:l AND id_turno=:t'''),
             {'r':datos.run_id,'f':datos.fecha,'l':linea,'t':datos.turno}).mappings().first()
        if previo:
            raise HTTPException(409,'Turno ya consolidado. No se alteraron los registros.')
        common={'r':datos.run_id,'l':linea}
        filas = cx.execute(text('''SELECT u.id_unidad,u.numero_serie,u.id_lote FROM unidades u
             JOIN lote lo ON lo.id_lote=u.id_lote
             JOIN sim_ordenes so ON so.id_orden=lo.id_orden
             WHERE so.run_id=:r AND so.id_linea=:l AND u.id_linea=:l
               AND u.id_turno=:t AND u.numero_serie=ANY(CAST(:series AS text[]))'''),
             dict(common,t=datos.turno,series=datos.series)).mappings().all() if datos.series else []
        if len(filas) != len(datos.series) or {f['numero_serie'] for f in filas} != set(datos.series):
            raise HTTPException(409,'Series no encontradas o ajenas al turno/orden simulada')
        uid=[f['id_unidad'] for f in filas]
        lotes=list({f['id_lote'] for f in filas})
        cajas=ids_verificados(cx,'''SELECT c.id_caja FROM cajas c JOIN sim_ordenes so ON so.id_orden=c.id_orden
              WHERE so.run_id=:r AND so.id_linea=:l AND c.id_caja=ANY(CAST(:ids AS integer[]))''',
              dict(common,ids=datos.cajas),datos.cajas,'Cajas')
        embarques=ids_verificados(cx,'''SELECT e.id_embarque FROM embarques e JOIN sim_ordenes so ON so.id_orden=e.id_orden
              WHERE so.run_id=:r AND so.id_linea=:l AND e.id_embarque=ANY(CAST(:ids AS integer[]))''',
              dict(common,ids=datos.embarques),datos.embarques,'Embarques')
        incidencias=ids_verificados(cx,'''SELECT id_incidencia FROM incidencias_web
              WHERE id_linea=:l AND id_incidencia=ANY(CAST(:ids AS integer[]))''',
              dict(l=linea,ids=datos.incidencias),datos.incidencias,'Incidencias')
        if datos.cierre_id is not None:
            cierre=ids_verificados(cx,'''SELECT id_cierre FROM cierresturno
                 WHERE origen_web AND id_linea=:l AND id_turno=:t
                 AND id_cierre=ANY(CAST(:ids AS integer[]))''',
                 dict(l=linea,t=datos.turno,ids=[datos.cierre_id]),[datos.cierre_id],'Cierre')
        else:
            cierre=[]
        if uid:
            cx.execute(text('UPDATE unidades SET fecha_hora=:f WHERE id_unidad=ANY(CAST(:ids AS integer[]))'),dict(f=t0,ids=uid))
            cx.execute(text('UPDATE lote SET fecha_creacion=:f WHERE id_lote=ANY(CAST(:ids AS integer[]))'),dict(f=t0,ids=lotes))
            cx.execute(text('UPDATE ensamble SET fecha_ensamble=:f WHERE id_lote=ANY(CAST(:ids AS integer[]))'),dict(f=t0,ids=lotes))
            cx.execute(text('''WITH q AS (SELECT id_prueba,ROW_NUMBER() OVER
                (PARTITION BY id_unidad ORDER BY id_prueba) AS n FROM pruebas
                WHERE id_unidad=ANY(CAST(:ids AS integer[])))
                UPDATE pruebas p SET fecha=:f+(q.n-1)*INTERVAL '5 minutes'
                FROM q WHERE p.id_prueba=q.id_prueba'''),dict(f=tpr,ids=uid))
            cx.execute(text('''WITH q AS (SELECT id_calidad,ROW_NUMBER() OVER
                (PARTITION BY id_unidad ORDER BY id_calidad) AS n FROM calidad
                WHERE id_unidad=ANY(CAST(:ids AS integer[])))
                UPDATE calidad c SET fecha=:f+(q.n-1)*INTERVAL '60 minutes'
                FROM q WHERE c.id_calidad=q.id_calidad'''),dict(f=tcal,ids=uid))
            cx.execute(text('''UPDATE retrabajo SET fecha=:f, fecha_fin=CASE WHEN fecha_fin IS NOT NULL
                THEN CAST(:f AS timestamp)+INTERVAL '20 minutes' ELSE NULL END
                WHERE id_unidad=ANY(CAST(:ids AS integer[]))'''),dict(f=tcal+timedelta(minutes=15),ids=uid))
            cx.execute(text('''WITH q AS (SELECT id_bitacora,ROW_NUMBER() OVER
                (PARTITION BY id_registro_afectado ORDER BY id_bitacora) AS n
                FROM bitacora_general WHERE tabla_afectada='unidades'
                AND id_registro_afectado=ANY(CAST(:ids AS integer[])))
                UPDATE bitacora_general b SET fecha_hora=:f+(q.n-1)*INTERVAL '12 minutes'
                FROM q WHERE b.id_bitacora=q.id_bitacora'''),dict(f=t0,ids=uid))
        if cajas:
            cx.execute(text('''UPDATE cajas SET fecha_creacion=:f,
                fecha_cierre=CASE WHEN fecha_cierre IS NOT NULL
                THEN CAST(:f AS timestamp)+INTERVAL '25 minutes' ELSE NULL END
                WHERE id_caja=ANY(CAST(:ids AS integer[]))'''),dict(f=tcaja,ids=cajas))
            cx.execute(text('''WITH q AS (SELECT id_bitacora,ROW_NUMBER() OVER
                (PARTITION BY id_registro_afectado ORDER BY id_bitacora) AS n
                FROM bitacora_general WHERE tabla_afectada='cajas'
                AND id_registro_afectado=ANY(CAST(:ids AS integer[])))
                UPDATE bitacora_general b SET fecha_hora=:f+(q.n-1)*INTERVAL '5 minutes'
                FROM q WHERE b.id_bitacora=q.id_bitacora'''),dict(f=tcaja,ids=cajas))
        if embarques:
            cx.execute(text('''UPDATE embarques SET fecha_creacion=:f,
                fecha_salida=CASE WHEN fecha_salida IS NOT NULL
                THEN CAST(:f AS timestamp)+INTERVAL '45 minutes' ELSE NULL END
                WHERE id_embarque=ANY(CAST(:ids AS integer[]))'''),dict(f=temb,ids=embarques))
            cx.execute(text('''WITH q AS (SELECT id_bitacora,ROW_NUMBER() OVER
                (PARTITION BY id_registro_afectado ORDER BY id_bitacora) AS n
                FROM bitacora_general WHERE tabla_afectada='embarques'
                AND id_registro_afectado=ANY(CAST(:ids AS integer[])))
                UPDATE bitacora_general b SET fecha_hora=:f+(q.n-1)*INTERVAL '10 minutes'
                FROM q WHERE b.id_bitacora=q.id_bitacora'''),dict(f=temb,ids=embarques))
        if incidencias:
            cx.execute(text('UPDATE incidencias_web SET fecha=:f WHERE id_incidencia=ANY(CAST(:ids AS integer[]))'),dict(f=t0+timedelta(minutes=5),ids=incidencias))
        if cierre:
            cx.execute(text('UPDATE cierresturno SET fecha=:f WHERE id_cierre=:id'),dict(f=tfin,id=cierre[0]))
        cx.execute(text('''INSERT INTO sim_turnos(run_id,fecha,id_linea,id_turno,n_unidades,n_cajas,n_embarques)
             VALUES (:r,:f,:l,:t,:n,:c,:e)'''),dict(r=datos.run_id,f=datos.fecha,l=linea,t=datos.turno,
             n=len(uid),c=len(cajas),e=len(embarques)))
        return {'ok':True,'fecha':datos.fecha.isoformat(),'linea':datos.linea,'turno':datos.turno,
                'unidades':len(uid),'cajas':len(cajas),'embarques':len(embarques)}


@router.get('/resumen/{run_id}')
def resumen(run_id: str, actor=Depends(protegido)):
    if not re.fullmatch(RUN_PATTERN,run_id):
        raise HTTPException(422,'Run ID invalido')
    with engine.begin() as cx:
        tablas(cx)
        estados=[dict(f) for f in cx.execute(text('''SELECT u.estado,COUNT(*) AS cantidad FROM unidades u
             JOIN lote l USING(id_lote) JOIN sim_ordenes so ON so.id_orden=l.id_orden
             WHERE so.run_id=:r AND u.numero_serie LIKE :p
             GROUP BY u.estado ORDER BY u.estado'''),dict(r=run_id,p=run_id+'-%')).mappings()]
        dias=[dict(fecha=f['fecha'].isoformat(),producidas=f['n']) for f in cx.execute(text('''SELECT u.fecha_hora::date AS fecha,COUNT(*) AS n
             FROM unidades u JOIN lote l USING(id_lote) JOIN sim_ordenes so ON so.id_orden=l.id_orden
             WHERE so.run_id=:r AND u.numero_serie LIKE :p
             GROUP BY u.fecha_hora::date ORDER BY fecha'''),dict(r=run_id,p=run_id+'-%')).mappings()]
        turnos=cx.execute(text('SELECT COUNT(*) FROM sim_turnos WHERE run_id=:r'),{'r':run_id}).scalar_one()
        return {'run_id':run_id,'total_unidades':sum(r['cantidad'] for r in estados),
                'turnos_consolidados':turnos,'estados':estados,'dias':dias}
