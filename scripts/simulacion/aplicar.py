#!/usr/bin/env python3
"""NOVA SOUND: ejecucion industrial por API real, con historicos aislados.

Toda escritura de operaciones utiliza endpoints oficiales. El router especial
SOLO prepara ordenes y consolida fechas historicas de eventos ya existentes.
No hay credenciales hardcodeadas y el script NO conecta a PostgreSQL.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
import json
import hashlib
import random
from pathlib import Path
import sys

from cliente_api import Cliente, ApiError
from simular import guardar, simular

BASE=Path(__file__).resolve().parents[2]
DIR=Path(__file__).resolve().parent


def leer_env(ruta):
    if not ruta.is_file():
        raise SystemExit('No existe .env.simulacion: ejecuta crear_entorno.py primero.')
    out={}
    for line in ruta.read_text(encoding='utf-8').splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key,value=line.split('=',1)
        out[key.strip()]=value.strip().strip("'\"")
    for key in ('SIMULACION_KEY','SISTEMAS_USUARIO','SISTEMAS_PASSWORD',
                'SIM_OPERADOR_PASSWORD','SIM_LIDER_PASSWORD','SIM_CALIDAD_PASSWORD','SIM_ALMACEN_PASSWORD'):
        if not out.get(key):
            raise SystemExit(f'Falta {key} en .env.simulacion')
    return out


def registrar_usuarios(api,env,seed):
    perfiles={
      'operador':('Operador','SIM_OPERADOR_PASSWORD'),
      'lider':('Líder de línea','SIM_LIDER_PASSWORD'),
      'calidad':('Calidad','SIM_CALIDAD_PASSWORD'),
      'almacen':('Empaque','SIM_ALMACEN_PASSWORD'),
      'embarques':('Embarques','SIM_EMBARQUES_PASSWORD' if env.get('SIM_EMBARQUES_PASSWORD') else 'SIM_ALMACEN_PASSWORD'),
    }
    empleados = {}
    for indice,(perfil,(rol,password_key)) in enumerate(perfiles.items(), 1):
        usuario=f'89{indice}{int(seed < 0)}{abs(seed)}'
        info={'numEmpleado':usuario,'nombre':f'Simulacion - {perfil.title()}',
              'rol':rol,'estado':'Activo','contrasena':env[password_key]}
        try:
            api.post('/api/v1/gestion/usuarios',info,'sistemas')
        except ApiError as e:
            if e.status != 409:
                raise
            anterior=api.get('/api/v1/gestion/usuarios/'+usuario,'sistemas')
            if anterior.get('rol') != rol:
                raise RuntimeError(f'Usuario existente {usuario} tiene rol inesperado') from e
        api.login(usuario,env[password_key],perfil)
        empleados[perfil] = usuario
    return empleados


def preparar_ordenes(api,plan,run_id):
    modelos=sorted(m['nombre'] for m in plan['config_modelos'])
    lineas=sorted({u['linea'] for u in plan['unidades']})
    fin=date.fromisoformat(plan['resumen']['fecha_fin'])
    mapping={}
    for l in lineas:
        for modelo in modelos:
            r=api.post('/api/v1/simulacion/ordenes',
                {'run_id':run_id,'linea':l,'modelo':modelo,
                 'cantidad':10000,'fecha_compromiso':(fin+timedelta(days=4)).isoformat()},
                'sistemas',sim=True)
            mapping[(l,modelo)]=r['id_orden']
    return mapping


def seleccionar_defecto(catalogos,clave):
    categorias=catalogos.get('categorias',{}).get('items',[])
    defectos=catalogos.get('defectos',{}).get('items',[])
    if not categorias or not defectos:
        raise RuntimeError('No hay categorias y defectos activos. Revisa migracion 08 y catalogos.')
    funcional = clave in {'FUNCIONAL','AUDIO','ENCENDIDO','CARGA','BLUETOOTH'}
    candidatos=[c for c in categorias if ('funcional' in c['nombre'].casefold())==funcional]
    if not candidatos:
        candidatos=categorias
    for cat in candidatos:
        disponible=next((d for d in defectos if d['codigo'].startswith(cat['codigo']+'-')),None)
        if disponible:
            return {'categoria':cat['nombre'],'defecto':disponible['nombre'],'causa':
                    'Hallazgo sintetico de '+str(clave).lower()+'; inspeccion de simulacion'}
    raise RuntimeError('No hay defectos activos con el prefijo de categoria esperado')


def probar(api,u):
    serie=u['numero_serie']
    evaluaciones={x:'Aprobada' for x in ('encendido','audio','carga','bluetooth')}
    if u['estado_previsto']=='FALLA_FUNCIONAL':
        mapa={'AUDIO':'audio','ENCENDIDO':'encendido','CARGA':'carga','BLUETOOTH':'bluetooth'}
        evaluaciones[mapa[u['defecto_previsto']]]='Falla'
    fallo='Falla' in evaluaciones.values()
    return api.post('/api/v1/pruebas/resultado',{'serie':serie,'prueba':evaluaciones,
        'observaciones':'Falla intermitente detectada en estacion funcional' if fallo else ''},'operador')


def inspeccionar(api,u,catalogos):
    estado=u['estado_previsto']
    serie=u['numero_serie']
    if estado=='FALLA_FUNCIONAL':
        return
    if u.get('retrabajo_previsto') == 'CORREGIDO':
        defecto=seleccionar_defecto(catalogos,u['defecto_previsto'])
        api.post('/api/v1/calidad/unidades/'+serie+'/inspeccion',
            {'disposicion':'RETRABAJO','defectos':[defecto],
             'observaciones':'Detectado defecto recuperable en inspeccion'},'calidad')
        api.post('/api/v1/calidad/unidades/'+serie+'/retrabajo',
            {'descripcion':'Se corrigio el defecto y se verifico el componente',
             'resultado':'Corregido','observaciones':'Retrabajo aprobado en simulacion'},'calidad')
        api.post('/api/v1/calidad/unidades/'+serie+'/inspeccion',
            {'disposicion':'LIBERADA','defectos':[],
             'observaciones':'Reinspeccion posterior a retrabajo corregido'},'calidad')
        return
    if estado=='LIBERADA':
        api.post('/api/v1/calidad/unidades/'+serie+'/inspeccion',
            {'disposicion':'LIBERADA','defectos':[],'observaciones':''},'calidad')
        return
    estado_api={'EN_RETRABAJO':'RETRABAJO','EN_RETENCION':'EN_RETENCION','SCRAP':'SCRAP'}[estado]
    api.post('/api/v1/calidad/unidades/'+serie+'/inspeccion',
        {'disposicion':estado_api,'defectos':[seleccionar_defecto(catalogos,u['defecto_previsto'])],
         'observaciones':'Defecto grave en inspeccion; unidad rechazada' if estado_api=='SCRAP'
         else 'Unidad bloqueada por inspeccion de calidad'},'calidad')


def empacar_y_embarcar(api,unidades,ordenes,capacidades,rng,run_id,fecha,linea,turno):
    """Solo unidades liberadas; la API aplica validaciones reales de caja y salida."""
    por_modelo=defaultdict(list)
    for u in unidades:
        if u['estado_previsto']=='LIBERADA' and rng.random()<0.72:
            por_modelo[u['modelo']].append(u['numero_serie'])
    creadas=[]; embarques=[]
    for modelo,series in sorted(por_modelo.items()):
        orden=ordenes[(linea,modelo)]
        cap=capacidades[modelo]
        cerradas=[]
        for k in range(0,len(series),cap):
            chunk=series[k:k+cap]
            caja=api.post('/api/v1/almacen/cajas',{'id_orden':orden},'almacen')
            caja_id=caja['id_caja']; creadas.append(caja_id)
            for serie in chunk:
                api.post(f'/api/v1/almacen/cajas/{caja_id}/unidades',{'numero_serie':serie},'almacen')
            if rng.random()>=0.12:
                api.post(f'/api/v1/almacen/cajas/{caja_id}/cerrar',
                         {'motivo':'Cierre parcial por volumen del turno de simulacion'},'almacen')
                cerradas.append(caja_id)
        if not cerradas:
            continue
        referencia=f'{run_id}-{fecha.replace("-","")}-{linea}-T{turno}-{modelo}'
        embarque=api.post('/api/v1/almacen/embarques',
            {'id_orden':orden,'referencia':referencia[:100],
             'destino':'Centro de distribucion sintetico',
             'contenedor':f'CONT-{run_id[-6:]}-{fecha[-2:]}-{linea}-{turno}-{modelo[3:]}'[:100]},'embarques')
        eid=embarque['id_embarque']; embarques.append(eid)
        for cid in cerradas:
            if rng.random()<0.75:
                api.post(f'/api/v1/almacen/embarques/{eid}/cajas/{cid}',{},'embarques')
        # Solo se confirma salida si tiene cajas asignadas y no se simula un retraso.
        detalle=api.get(f'/api/v1/almacen/embarques/{eid}','embarques')
        if detalle['cantidad_cajas']>0 and rng.random()<0.78:
            api.post(f'/api/v1/almacen/embarques/{eid}/salida',{},'embarques')
    return creadas,embarques


def obtener_id_cierre(api,fecha_actual,linea,turno):
    data=api.get('/api/v1/gestion/operacion','lider')
    posibles=[c for c in data['cierres'] if c['fecha']==fecha_actual and c['linea']==linea and
              int(c['turno'])==int(turno) and c['origen_web']]
    if len(posibles)!=1:
        raise RuntimeError(f'Se esperaba un cierre del dia actual para {linea} turno {turno}; encontrados {len(posibles)}')
    return int(posibles[0]['id_cierre'])


def aplicar(api,plan,run_id,ordenes,limite,carpeta):
    catalogos=api.get('/api/v1/calidad/catalogos','calidad')
    op=api.get('/api/v1/gestion/opciones','operador')
    lineas=set(op['lineas']); turnos={int(x['valor']) for x in op['turnos']}
    capacidades={m['nombre']:m['capacidad_caja'] for m in plan['config_modelos']}
    for u in plan['unidades']:
        if u['linea'] not in lineas or int(u['turno']) not in turnos:
            raise RuntimeError('Linea o turno del escenario no existe en catalogos activos')
    grupos=defaultdict(list)
    for u in plan['unidades']:
        grupos[(u['fecha_simulada'],u['linea'],int(u['turno']))].append(u)
    incidencias=defaultdict(list)
    for i in plan['incidentes']:
        incidencias[(i['fecha'],i['linea'],int(i['turno']))].append(i)
    terminado=api.get(f'/api/v1/simulacion/progreso/{run_id}','sistemas',sim=True)
    completados={(x['fecha'],x['linea'],x['turno']) for x in terminado['turnos']}
    total=sum(x['unidades'] for x in terminado['turnos']); contador=Counter()
    procesados=0
    meta=int(plan['meta_unidades_por_turno'])
    pesos={m['nombre']:m['peso'] for m in plan['config_modelos']}
    for k, (clave,filas) in enumerate(sorted(grupos.items())):
        if clave in completados:
            continue
        if limite and total>=limite:
            break
        fecha,linea,turno=clave
        # NOVA_SIM_CLOCK_V2: la fecha operativa es exclusiva de este turno.
        api.fecha_simulada=fecha
        # Limite de prueba: reduce el ultimo turno al saldo restante.
        actuales=filas if not limite else filas[:max(0,limite-total)]
        if not actuales and not incidencias[clave]:
            continue
        try:
            # Metas de la jornada por orden/modelo: no se derivan de unidades reales.
            metas={m:int(meta*p) for m,p in pesos.items()}
            sobrante=meta-sum(metas.values())
            for modelo in sorted(pesos,key=lambda m:(-(meta*pesos[m]-metas[m]),m))[:sobrante]:
                metas[modelo]+=1
            api.post('/api/v1/simulacion/objetivos',
                {'run_id':run_id,'fecha':fecha,'linea':linea,'turno':turno,'metas':metas},
                'sistemas',sim=True)
            inc_ids=[]
            for item in incidencias[clave]:
                tipo='Equipo' if item['tipo']=='PARO_EQUIPO' else 'Material'
                incidente=api.post('/api/v1/gestion/operacion/registrarIncidencia',
                    {'linea':linea,'tipo':tipo,'severidad':'Alta' if item['minutos_paro']>80 else 'Media',
                     'paro':item['minutos_paro'],'motivo':f'SIM {run_id}: '+item['descripcion']},'lider')
                inc_ids.append(int(incidente['id']))
            for i,u in enumerate(actuales):
                orden=ordenes[(linea,u['modelo'])]
                lote=f'{run_id}-{fecha}-{linea}-T{turno}-{u["modelo"]}'
                api.post('/api/v1/gestion/operacion/registrarUnidad',
                    {'orden':orden,'turno':turno,'serie':u['numero_serie'],'lote':lote},'operador')
                probar(api,u)
                inspeccionar(api,u,catalogos)
                contador[u['estado_previsto']]+=1
            # Cierre real del turno ANTES de retroceder fechas; g.hoy(cx) ve solo este turno.
            api.post('/api/v1/gestion/operacion/cerrarTurno',
                {'linea':linea,'turno':turno,'motivo':f'Cierre simulado de turno {fecha}, {linea}, T{turno}'},'lider')
            fecha_actual=api.get('/api/v1/gestion/operacion','lider')['fecha']
            cierre_id=obtener_id_cierre(api,fecha_actual,linea,turno)
            # Aleatoriedad independiente por turno para reanudaciones reproducibles.
            digest=hashlib.sha256(f'{run_id}-{fecha}-{linea}-{turno}'.encode()).digest()
            rng=random.Random(int.from_bytes(digest[:8],'big'))
            cajas,embarques=empacar_y_embarcar(api,actuales,ordenes,capacidades,rng,run_id,fecha,linea,turno)
            api.post('/api/v1/simulacion/consolidar-turno',
                {'run_id':run_id,'fecha':fecha,'linea':linea,'turno':turno,
                 'series':[u['numero_serie'] for u in actuales],
                 'cajas':cajas,'embarques':embarques,'incidencias':inc_ids,'cierre_id':cierre_id},
                'sistemas',sim=True)
            api.fecha_simulada=None
            total+=len(actuales);procesados+=1
            print(f'[{k+1}/{len(grupos)}] {fecha} {linea} T{turno}: '
                  f'{len(actuales)} unidades, {len(cajas)} cajas, {len(embarques)} embarques',flush=True)
        except Exception as e:
            raise RuntimeError(f'ERROR DURANTE TURNO {fecha} {linea} T{turno}. '
                f'No reintentes el mismo turno sin verificar datos parciales; puedes utilizar otra semilla. Detalle: {e}') from e
    resumen=api.get(f'/api/v1/simulacion/resumen/{run_id}','sistemas',sim=True)
    (carpeta/'resumen_bd.json').write_text(json.dumps(resumen,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('RESUMEN PostgreSQL:',json.dumps(resumen,ensure_ascii=False))
    return resumen


def plan_por_cantidad(cfg, cantidad):
    """Genera tantas unidades como se soliciten y deja un manifiesto coherente."""
    cfg = dict(cfg)
    jornadas = cfg["dias_operativos"] * len(cfg["lineas"]) * len(cfg["turnos"])
    cfg["meta_unidades_por_turno"] = max(cfg["meta_unidades_por_turno"], (cantidad + jornadas - 1) // jornadas)
    plan = simular(cfg)
    for _ in range(10):
        if len(plan["unidades"]) >= cantidad:
            break
        if cfg["operacion"]["factor_ritmo_normal"][1] == 0:
            raise ValueError("La configuración no permite producir unidades.")
        cfg["meta_unidades_por_turno"] *= 2
        plan = simular(cfg)
    if len(plan["unidades"]) < cantidad:
        raise ValueError("La configuración no alcanza la cantidad solicitada.")
    plan["unidades"] = plan["unidades"][:cantidad]
    llave = lambda fila, fecha: (fila[fecha], fila["linea"], fila["turno"])
    conteos = Counter(llave(u, "fecha_simulada") for u in plan["unidades"])
    if max(conteos.values()) > 2000:
        raise ValueError("El plan supera 2000 unidades por turno. Usa una configuración con más días.")
    plan["turnos"] = [
        {**t, "producidas": conteos[llave(t, "fecha")]}
        for t in plan["turnos"] if llave(t, "fecha") in conteos
    ]
    plan["incidentes"] = [i for i in plan["incidentes"] if llave(i, "fecha") in conteos]
    estados = Counter(u["estado_previsto"] for u in plan["unidades"])
    primera = sum(u["estado_previsto"] == "LIBERADA" and not u["retrabajo_previsto"] for u in plan["unidades"])
    meta = sum(t["meta"] for t in plan["turnos"])
    fechas = sorted({t["fecha"] for t in plan["turnos"]})
    plan["resumen"].update(
        dias_operativos=len(fechas), fecha_inicio=fechas[0], fecha_fin=fechas[-1],
        turnos_simulados=len(plan["turnos"]), producidas=cantidad, meta_total=meta,
        cumplimiento_meta_pct=round(100 * cantidad / meta, 2),
        liberadas_sin_retrabajo_pct_sobre_producidas=round(100 * primera / cantidad, 2),
        estados_previstos=dict.fromkeys(plan["resumen"]["estados_previstos"], 0) | dict(estados),
        incidencias=dict(Counter(i["tipo"] for i in plan["incidentes"])),
    )
    return plan, cfg["meta_unidades_por_turno"]


def usar_fechas_disponibles(api, plan, dias_laborables):
    """Mueve el plan a fechas anteriores libres cuando ya existen cierres."""
    cierres = api.get("/api/v1/gestion/operacion", "operador")["cierres"]
    lineas_turnos = {(t["linea"], int(t["turno"])) for t in plan["turnos"]}
    ocupadas = {
        c["fecha"] for c in cierres
        if (c["linea"], int(c["turno"])) in lineas_turnos
    }
    fechas = sorted({t["fecha"] for t in plan["turnos"]})
    if not ocupadas.intersection(fechas):
        return
    libres = []
    dia = date.fromisoformat(fechas[0]) - timedelta(days=1)
    while dia >= date(2020, 1, 1) and len(libres) < len(fechas):
        if dia.weekday() in dias_laborables and dia.isoformat() not in ocupadas:
            libres.append(dia.isoformat())
        dia -= timedelta(days=1)
    if len(libres) < len(fechas):
        raise RuntimeError("No hay suficientes fechas operativas sin cierres para este plan.")
    libres.reverse()
    nuevas = dict(zip(fechas, libres))
    for coleccion, llave in (("turnos", "fecha"), ("incidentes", "fecha"), ("unidades", "fecha_simulada")):
        for fila in plan[coleccion]:
            fila[llave] = nuevas[fila[llave]]
    plan["resumen"].update(fecha_inicio=libres[0], fecha_fin=libres[-1])
    print(f'Fechas con cierres detectados. Plan reubicado a {libres[0]}–{libres[-1]}.')


def generar_tickets(api, empleados, semilla):
    existentes = {t["numEmpleado"] for t in api.get("/api/v1/gestion/tickets", "sistemas")}
    rng = random.Random(semilla)
    for numero in empleados.values():
        if numero not in existentes:
            api.post("/api/v1/gestion/tickets", {
                "numEmpleado": numero, "motivo": rng.choice(["Cuenta bloqueada", "Olvidó la contraseña"]),
            }, "sistemas")


def main():
    parser=argparse.ArgumentParser(description='Inyeccion SOLO por API contra Docker aislado puerto 8001')
    parser.add_argument('--config',type=Path,default=DIR/'config_realista.json')
    parser.add_argument('--env-file',type=Path,default=BASE/'.env.simulacion')
    parser.add_argument('--base-url',default='http://127.0.0.1:8001')
    parser.add_argument('--seed',type=int,help='Permite otro lote independiente sin reemplazar datos')
    parser.add_argument('--meta-turno',type=int,help='Meta por linea y turno (ej.: 4 para prueba de 30 dias)')
    parser.add_argument('--cantidad', type=int, help='Cantidad exacta de unidades (mínimo 20)')
    parser.add_argument('--max-unidades',type=int,default=0,help='0=escenario completo; ejemplo 30=prueba corta')
    parser.add_argument('--aplicar',action='store_true',help='Confirma que deseas escribir en Docker de simulacion')
    args=parser.parse_args()
    if args.cantidad is not None and args.cantidad < 20:
        parser.error('--cantidad debe ser de al menos 20 unidades')
    if args.cantidad is not None and args.max_unidades:
        parser.error('usa --cantidad o --max-unidades')
    if args.max_unidades<0:
        raise SystemExit('--max-unidades no puede ser negativo')
    cfg=json.loads(args.config.read_text(encoding='utf-8'))
    if args.seed is not None:
        cfg['semilla']=args.seed
    if args.meta_turno is not None:
        if not 1<=args.meta_turno<=2000:
            raise SystemExit('--meta-turno debe estar entre 1 y 2000')
        cfg['meta_unidades_por_turno']=args.meta_turno
    if args.cantidad is not None:
        plan, cfg['meta_unidades_por_turno'] = plan_por_cantidad(cfg, args.cantidad)
    else:
        plan = simular(cfg)
    plan['config_modelos']=cfg['modelos']
    plan['meta_unidades_por_turno']=cfg['meta_unidades_por_turno']
    run_id=f'SIM-{plan["semilla"]}'
    carpeta=BASE/'resultados'/f'simulacion_{plan["semilla"]}'
    if not args.aplicar:
        carpeta = BASE / 'resultados' / f'plan_{plan["semilla"]}'
        guardar(plan, carpeta)
        print('PLAN:', json.dumps(plan['resumen'], ensure_ascii=False))
        print(f'Manifiesto: {carpeta}/escenario.json')
        print('MODO SEGURO: no se hicieron escrituras; agrega --aplicar para usar la API aislada.')
        return
    env=leer_env(args.env_file)
    api=Cliente(args.base_url,env['SIMULACION_KEY'])
    api.login(env['SISTEMAS_USUARIO'],env['SISTEMAS_PASSWORD'],'sistemas')
    estado=api.get('/api/v1/simulacion/estado','sistemas',sim=True)
    if estado.get('modo')!='simulacion_aislada' or estado.get('db')!='nova_sounds_simulacion':
        raise SystemExit('ABORTADO: no es el entorno esperado de simulacion')
    if args.cantidad is not None:
        progreso = api.get(f'/api/v1/simulacion/progreso/{run_id}', 'sistemas', sim=True)
        if progreso['turnos']:
            raise SystemExit('Esa semilla ya tiene datos aplicados. Usa otra --seed para una corrida nueva.')
    empleados = registrar_usuarios(api,env,plan['semilla'])
    if args.cantidad is not None:
        usar_fechas_disponibles(api, plan, cfg['dias_semana_laborables'])
    guardar(plan, carpeta)
    print('PLAN:', json.dumps(plan['resumen'], ensure_ascii=False))
    print(f'Manifiesto: {carpeta}/escenario.json')
    ordenes=preparar_ordenes(api,plan,run_id)
    res=aplicar(api,plan,run_id,ordenes,args.max_unidades,carpeta)
    if args.cantidad is not None and res["total_unidades"] != args.cantidad:
        raise RuntimeError(f'Se esperaban {args.cantidad} unidades y PostgreSQL reportó {res["total_unidades"]}.')
    if args.cantidad is not None:
        generar_tickets(api, empleados, plan['semilla'])
    print(f'LISTO. {res["total_unidades"]} unidades en base aislada; turnos {res["turnos_consolidados"]}.')


if __name__=='__main__':
    main()
