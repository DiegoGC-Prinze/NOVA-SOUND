"""Permisos reales consultados en cada petición; nunca se confía en sessionStorage."""
import json
from pathlib import Path

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core import sesiones

CONTRATOS = json.loads(Path(__file__).with_name('contratos.json').read_text(encoding='utf-8'))
PANTALLAS = {p['id'] for p in CONTRATOS['pantallas']}
ACCIONES = {a['id'] for a in CONTRATOS['acciones']}
ADMINISTRAR = 'administrar-usuarios-roles-catalogos-y-parametros'


def permisos_reales(permisos, acciones):
    return ({k: v for k, v in (permisos or {}).items()
             if k in PANTALLAS or k in {'login/login', 'login/levantar-ticket'}},
            [a for a in (acciones or []) if a in ACCIONES])


def actor_actual(request: Request):
    header = request.headers.get('Authorization', '')
    if not header.lower().startswith('bearer '):
        raise HTTPException(401, 'Inicia sesión para continuar.')
    uid = sesiones.identificar_token(header.split(' ', 1)[1])
    try:
        with sesiones.engine.connect() as cx:
            u = cx.execute(text('''SELECT u.id_usuario,u.usuario,u.nombre,r.nombre AS rol,
                r.permisos,r.acciones FROM usuarios u JOIN roles r USING(id_rol)
                WHERE u.id_usuario=:id AND u.activo AND u.estado='Activo'
            '''), {'id': uid}).mappings().first()
            if not u:
                raise HTTPException(401, 'La cuenta ya no está activa.')
            return dict(u)
    except SQLAlchemyError as exc:
        raise HTTPException(503, 'No se pudieron consultar los permisos en PostgreSQL.') from exc


def exigir(actor, pantalla, *, escribir=False, accion=None):
    nivel = (actor['permisos'] or {}).get(pantalla)
    if nivel not in {'ver', 'acciona'} or (escribir and nivel != 'acciona') or (accion and accion not in (actor['acciones'] or [])):
        raise HTTPException(403, 'Tu rol no tiene permiso para esta operación.')


def exigir_alguna(actor, pantallas):
    if not any((actor['permisos'] or {}).get(p) in {'ver', 'acciona'} for p in pantallas):
        raise HTTPException(403, 'Tu rol no tiene acceso a esta información.')
