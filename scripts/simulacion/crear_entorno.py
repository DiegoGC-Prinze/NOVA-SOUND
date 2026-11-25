#!/usr/bin/env python3
"""Crea credenciales exclusivamente para el proyecto Docker de simulacion."""
from pathlib import Path
import secrets
import stat

root=Path(__file__).resolve().parents[2]
target=root/'.env.simulacion'
if target.exists():
    raise SystemExit('.env.simulacion ya existe. No se sobrescribieron credenciales ni datos.')
values={
'DB_NAME':'nova_sounds_simulacion',
'DB_USER':'nova_sim_app',
'DB_PASSWORD':secrets.token_urlsafe(24),
'APP_PORT':'8001',
'SISTEMAS_USUARIO':'sim_sistemas',
'SISTEMAS_NOMBRE':'Sistemas Simulacion',
'SISTEMAS_PASSWORD':secrets.token_urlsafe(24),
'SIMULACION_KEY':secrets.token_urlsafe(32),
'SIM_OPERADOR_PASSWORD':secrets.token_urlsafe(18),
'SIM_LIDER_PASSWORD':secrets.token_urlsafe(18),
'SIM_CALIDAD_PASSWORD':secrets.token_urlsafe(18),
'SIM_ALMACEN_PASSWORD':secrets.token_urlsafe(18),
}
# Todos los valores generados usan alfanumericos, guion y guion bajo: seguros para Compose.
with target.open('x',encoding='utf-8') as f:
    for key,value in values.items():
        f.write(f'{key}={value}\n')
target.chmod(stat.S_IRUSR|stat.S_IWUSR)
print('Creado .env.simulacion con permisos 600 y contrasenas aleatorias.')
print('No compartas ni agregues este archivo a Git.')
