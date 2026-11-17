"""Sesiones Bearer opacas: PostgreSQL guarda solo el digest del token."""
import hashlib
import hmac
import secrets

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine

router = APIRouter(prefix="/api/v1/auth", tags=["Sesión"])
EMPAQUE = ['inicio-de-empaque-panel-de-control', 'formar-caja', 'confirmar-cierre-de-caja', 'consultar-caja', 'historial-de-cajas', 'reportes-de-empaque']
EMBARQUES = ['armar-embarque', 'paquetes-en-embarcacion', 'cierre-de-caja-escaneo', 'confirmacion-de-cierre-de-caja', 'estado-del-embarque', 'rastreo-de-contenedor', 'grafica-de-embarques']
ALMACEN = {'administrador', 'almacén/empaque', 'almacén', 'almacen', 'empaque'}
SUPERVISORES = {'supervisor de almacén', 'supervisor almacen'}


class Credenciales(BaseModel):
    usuario: str = Field(min_length=1, max_length=50)
    contrasena: str = Field(min_length=1, max_length=255)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64).hex()
    return f'scrypt${salt}${digest}'


def verificar_password(password: str, almacenado: str) -> bool:
    if almacenado.startswith('scrypt$'):
        try:
            _, salt, esperado = almacenado.split('$')
            digest = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64).hex()
            return hmac.compare_digest(digest, esperado)
        except (ValueError, TypeError):
            return False
    # Compatibilidad con el seed existente; se actualiza al entrar correctamente.
    return hmac.compare_digest(password.encode('utf-8'), almacenado.encode('utf-8'))


def permisos_almacen(rol: str) -> tuple[dict, list]:
    nombre = rol.strip().casefold()
    if nombre in ALMACEN:
        permisos = {f'empaque/{p}': 'acciona' for p in EMPAQUE}
        permisos.update({f'embarques/{p}': 'acciona' for p in EMBARQUES})
        acciones = ['cerrar-caja', 'confirmar-salida-de-embarque']
        if nombre == 'administrador':
            acciones.append('reabrir-caja')
        return permisos, acciones
    if nombre in SUPERVISORES:
        return {f'empaque/{p}': 'acciona' if p == 'consultar-caja' else 'ver' for p in EMPAQUE if p not in ['formar-caja', 'confirmar-cierre-de-caja']}, ['reabrir-caja']
    raise HTTPException(status_code=403, detail='Esta cuenta no tiene acceso a Almacén y Embarques.')


def identificar_token(token: str) -> int:
    if len(token) < 32 or len(token) > 200:
        raise HTTPException(status_code=401, detail='Sesión no válida o vencida.')
    try:
        with engine.connect() as cx:
            id_usuario = cx.execute(text('''
                SELECT s.id_usuario FROM sesiones_web s
                JOIN usuarios u ON u.id_usuario=s.id_usuario
                WHERE s.token_hash=:hash AND s.fecha_expiracion>CURRENT_TIMESTAMP AND u.activo AND u.estado='Activo'
            '''), {'hash': hashlib.sha256(token.encode()).hexdigest()}).scalar_one_or_none()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail='No se pudo validar la sesión en PostgreSQL.') from exc
    if id_usuario is None:
        raise HTTPException(status_code=401, detail='Sesión no válida o vencida.')
    return id_usuario


@router.post('/login')
def login(datos: Credenciales, response: Response):
    try:
        with engine.begin() as cx:
            filas = cx.execute(text('''
                SELECT u.id_usuario,u.usuario,u.nombre,u.contrasena,u.activo,u.estado,r.nombre AS rol,r.permisos,r.acciones
                FROM usuarios u JOIN roles r ON r.id_rol=u.id_rol
                WHERE u.usuario=:usuario ORDER BY u.id_usuario LIMIT 2 FOR UPDATE OF u
            '''), {'usuario': datos.usuario.strip()}).mappings().all()
            if len(filas) != 1 or not filas[0]['activo'] or filas[0]['estado'] != 'Activo' or not verificar_password(datos.contrasena, filas[0]['contrasena']):
                raise HTTPException(status_code=401, detail='Usuario o contraseña incorrectos.')
            u = filas[0]
            from app.core.acceso import permisos_reales
            permisos, acciones = permisos_reales(u['permisos'], u['acciones'])
            if not any(not p.startswith('login/') for p in permisos):
                raise HTTPException(403, 'Este rol no tiene pantallas habilitadas. Solicita acceso a Sistemas.')
            if not u['contrasena'].startswith('scrypt$'):
                cx.execute(text('UPDATE usuarios SET contrasena=:hash WHERE id_usuario=:id'), {'hash': hash_password(datos.contrasena), 'id': u['id_usuario']})
            token = secrets.token_urlsafe(32)
            cx.execute(text('DELETE FROM sesiones_web WHERE fecha_expiracion<=CURRENT_TIMESTAMP'))
            expiracion = cx.execute(text('''
                INSERT INTO sesiones_web(token_hash,id_usuario,fecha_expiracion)
                VALUES (:hash,:usuario,CURRENT_TIMESTAMP+INTERVAL '8 hours') RETURNING fecha_expiracion
            '''), {'hash': hashlib.sha256(token.encode()).hexdigest(), 'usuario': u['id_usuario']}).scalar_one()
            response.headers['Cache-Control'] = 'no-store'
            return {'token': token, 'modo': 'real', 'expiracion': expiracion,
                    'usuario': {'id': u['id_usuario'], 'numEmpleado': u['usuario'], 'nombre': u['nombre'], 'rol': u['rol']},
                    'permisos': permisos, 'acciones': acciones}
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail='No se pudo iniciar sesión. Revisa PostgreSQL y las migraciones 06 y 07.') from exc


@router.post('/logout', status_code=204)
def logout(request: Request):
    authorization = request.headers.get('Authorization', '')
    if authorization.lower().startswith('bearer '):
        token = authorization.split(' ', 1)[1]
        try:
            with engine.begin() as cx:
                cx.execute(text('DELETE FROM sesiones_web WHERE token_hash=:hash'), {'hash': hashlib.sha256(token.encode()).hexdigest()})
        except SQLAlchemyError as exc:
            raise HTTPException(status_code=503, detail='No se pudo cerrar la sesión en el servidor.') from exc
    return Response(status_code=204)
