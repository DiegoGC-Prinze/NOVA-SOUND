#!/usr/bin/env python3
"""Parche idempotente y delimitado al simulador de NOVA SOUND.

Agrega una fecha operativa por solicitud, validada en el puerto aislado.
No ejecuta consultas SQL ni modifica datos, volúmenes o ramas remotas.
"""
from __future__ import annotations

import ast
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'NOVA_SIM_CLOCK_V2'


def once(text: str, before: str, after: str, location: str) -> str:
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'{location}: esperada una coincidencia, encontradas {count}: {before[:90]!r}')
    return text.replace(before, after, 1)


def replace_region(text: str, start: str, end: str, transform, label: str) -> str:
    if text.count(start) != 1 or text.count(end) != 1:
        raise RuntimeError(f'{label}: delimitadores inesperados')
    a, mid = text.split(start, 1)
    region, b = mid.split(end, 1)
    return a + start + transform(region) + end + b


def patched_main(text: str) -> str:
    anchor = '    app.include_router(simulacion_router)\n'
    middleware = '''\n    # NOVA_SIM_CLOCK_V2: reloj por solicitud para operaciones de Producción\n    # SOLAMENTE dentro del entorno *_simulacion con clave privada.\n    import hmac\n    from datetime import date, timedelta\n    from fastapi import Request\n    from fastapi.responses import JSONResponse\n\n    @app.middleware('http')\n    async def reloj_simulacion(request: Request, call_next):\n        fecha = request.headers.get('X-Simulation-Date')\n        if fecha is not None:\n            clave = request.headers.get('X-Simulation-Key', '')\n            valida = (request.url.path.startswith('/api/v1/gestion/operacion')\n                      and os.getenv('NOVA_SIMULATION_MODE') == '1'\n                      and os.getenv('DB_NAME', '').endswith('_simulacion')\n                      and bool(os.getenv('NOVA_SIMULATION_KEY'))\n                      and hmac.compare_digest(clave, os.getenv('NOVA_SIMULATION_KEY', '')))\n            if not valida:\n                return JSONResponse({'detail': 'Reloj simulado no autorizado'}, status_code=403)\n            try:\n                dia = date.fromisoformat(fecha)\n            except ValueError:\n                return JSONResponse({'detail': 'Fecha simulada inválida'}, status_code=422)\n            if not date(2020, 1, 1) <= dia <= date.today() + timedelta(days=1):\n                return JSONResponse({'detail': 'Fecha fuera de rango permitido'}, status_code=422)\n            request.state.sim_fecha = dia\n        return await call_next(request)\n'''
    return once(text, anchor, anchor + middleware, 'backend/app/main.py')


def patched_gestion(text: str) -> str:
    text = once(text, 'from fastapi import APIRouter, Depends, HTTPException, Query',
                'from fastapi import APIRouter, Depends, HTTPException, Query, Request', 'gestion imports')
    text = once(text, "def consultar_produccion(actor=Depends(actor_actual)):",
                "def consultar_produccion(request: Request, actor=Depends(actor_actual)):", 'consultar_produccion')
    text = once(text, "def operar_produccion(accion: str, datos: dict, actor=Depends(actor_actual)):",
                "def operar_produccion(accion: str, datos: dict, request: Request, actor=Depends(actor_actual)):", 'operar_produccion')

    def consulta(b):
        return once(b, '        today = hoy(cx)',
                    '        today = getattr(request.state, "sim_fecha", None) or hoy(cx)', 'gestion consulta fecha')
    text = replace_region(text, 'def consultar_produccion(', '\ndef bloquear_turno(', consulta, 'gestion consulta')

    def produccion(b):
        b = once(b, '        today = hoy(cx)', '''        # NOVA_SIM_CLOCK_V2: usar el día del turno simulado validado por middleware.\n        sim_fecha = getattr(request.state, 'sim_fecha', None)\n        today = sim_fecha or hoy(cx)\n        fecha_operativa = datetime.combine(today, datetime.now().time())\n        fecha_sql = ':fecha_operativa' if sim_fecha is not None else AHORA''', 'gestion operar fecha')
        def unidad(u):
            if u.count('+ AHORA +') != 3:
                raise RuntimeError(f'registrarUnidad: se esperaban 3 marcas de tiempo, hay {u.count("+ AHORA +")}')
            u = u.replace('+ AHORA +', '+ fecha_sql +')
            u = once(u, 'o=orden[\'id_orden\'], n=orden[\'cantidad\'], c=codigo).scalar_one()',
                      'o=orden[\'id_orden\'], n=orden[\'cantidad\'], c=codigo, fecha_operativa=fecha_operativa).scalar_one()', 'lote parametros')
            u = once(u, "serie=serie, u=actor['id_usuario']).scalar_one()",
                      "serie=serie, u=actor['id_usuario'], fecha_operativa=fecha_operativa).scalar_one()", 'unidad parametros')
            u = once(u, "lo=lid)\n            auditar(cx, actor, 'unidades'",
                      "lo=lid, fecha_operativa=fecha_operativa)\n            auditar(cx, actor, 'unidades'", 'ensamble parametros')
            return u
        b = replace_region(b, "        if accion == 'registrarUnidad':", "        if accion == 'cerrarTurno':", unidad, 'bloque registrarUnidad')
        def cierre(c):
            if c.count('+ AHORA +') != 1:
                raise RuntimeError('cerrarTurno: se esperaba una única fecha de inserción')
            c = c.replace('+ AHORA +', '+ fecha_sql +')
            c = once(c, "u=actor['id_usuario'], l=linea['id'], t=turno, nota=nota,",
                     "u=actor['id_usuario'], l=linea['id'], t=turno, nota=nota, fecha_operativa=fecha_operativa,", 'cierre parametros')
            return c
        b = replace_region(b, "        if accion == 'cerrarTurno':", "        tipo = requerido(datos, 'tipo')", cierre, 'bloque cerrarTurno')
        return b
    return replace_region(text, 'def operar_produccion(', "\n@router.get('/autorizaciones')", produccion, 'gestion operar')


def patched_client(text: str) -> str:
    text = once(text, '        self.tokens={}', '        self.tokens={}\n        self.fecha_simulada=None  # NOVA_SIM_CLOCK_V2', 'cliente init')
    return once(text, "        if sim:\n            headers['X-Simulation-Key']=self.sim_key", """        if sim:\n            headers['X-Simulation-Key']=self.sim_key\n        if self.fecha_simulada and path.startswith('/api/v1/gestion/operacion'):\n            headers['X-Simulation-Date']=self.fecha_simulada\n            headers['X-Simulation-Key']=self.sim_key""", 'cliente header')


def patched_apply(text: str) -> str:
    text = once(text, '        fecha,linea,turno=clave', '''        fecha,linea,turno=clave\n        # NOVA_SIM_CLOCK_V2: la fecha operativa es exclusiva de este turno.\n        api.fecha_simulada=fecha''', 'aplicar fecha')
    return once(text, '            total+=len(actuales);procesados+=1',
                '            api.fecha_simulada=None\n            total+=len(actuales);procesados+=1', 'aplicar limpiar fecha')


def main():
    branch = subprocess.run(['git', 'branch', '--show-current'], cwd=ROOT, check=True,
                            capture_output=True, text=True).stdout.strip()
    if branch != 'feature/simulacion-industrial':
        raise SystemExit(f'ABORTADO: rama actual {branch!r}; se requiere feature/simulacion-industrial')
    files = {
        'backend/app/main.py': patched_main,
        'backend/app/modules/gestion.py': patched_gestion,
        'scripts/simulacion/cliente_api.py': patched_client,
        'scripts/simulacion/aplicar.py': patched_apply,
    }
    proposed = {}
    already = []
    for name, fn in files.items():
        p = ROOT/name
        if not p.is_file():
            raise SystemExit(f'No existe {name}. No se aplicaron cambios.')
        content=p.read_text(encoding='utf-8')
        if VERSION in content:
            already.append(name)
            continue
        new=fn(content)
        ast.parse(new, filename=name)
        proposed[name]=new
    if already and proposed:
        raise SystemExit('Parche parcial detectado. No se aplicaron cambios: '+', '.join(already))
    if not proposed:
        print('El reloj simulado V2 ya está instalado; no hay cambios.')
        return
    back_dir=ROOT/'resultados'/'respaldo_reloj_v2'
    back_dir.mkdir(parents=True,exist_ok=True)
    for name, new in proposed.items():
        p=ROOT/name
        backup=back_dir/(name.replace('/','__')+'.bak')
        shutil.copy2(p,backup)
        p.write_text(new,encoding='utf-8')
        print(f'Actualizado {name} (respaldo: {backup.relative_to(ROOT)})')
    print('LISTO: reconstruye SOLO app del proyecto nova-sound-presentacion.')


if __name__ == '__main__':
    main()
