#!/usr/bin/env python3
"""Registra el router de simulacion SOLO en la rama esperada y antes del frontend."""
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[2]
branch=subprocess.run(['git','branch','--show-current'],cwd=root,capture_output=True,text=True,check=True).stdout.strip()
if branch != 'feature/simulacion-industrial':
    raise SystemExit(f'ABORTADO: rama activa {branch!r}; se requiere feature/simulacion-industrial')
path=root/'backend/app/main.py'
s=path.read_text(encoding='utf-8')
marker='# Registrar el frontend AL FINAL'
new='''# Registro de API historica EXCLUSIVAMENTE en una instalacion aislada.\nif os.getenv("NOVA_SIMULATION_MODE") == "1":\n    if not os.getenv("DB_NAME", "").endswith("_simulacion"):\n        raise RuntimeError("El reloj simulado requiere una base dedicada *_simulacion")\n    from app.modules.simulacion.router import router as simulacion_router\n    app.include_router(simulacion_router)\n\n'''
if 'app.include_router(simulacion_router)' in s:
    print('Router de simulacion ya registrado; ningun cambio.')
elif marker in s:
    path.write_text(s.replace(marker,new+marker,1),encoding='utf-8')
    print('Router de simulacion registrado en backend/app/main.py')
else:
    raise SystemExit('No se encontro ancla segura para insertar el router; NO se modifico main.py.')

ignore=root/'.gitignore'
g=ignore.read_text(encoding='utf-8') if ignore.exists() else ''
if '/resultados/' not in g:
    with ignore.open('a',encoding='utf-8') as f:
        f.write('\n# Evidencia de simulaciones (no publicar datos generados)\n/resultados/\n')
    print('Se agrego /resultados/ a .gitignore')
