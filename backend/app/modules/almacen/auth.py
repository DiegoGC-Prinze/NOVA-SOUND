"""Identidad de Almacén mediante sesiones Bearer verificadas en PostgreSQL.

ALMACEN_DEV_MODE=1 habilita únicamente pruebas LOCALES sin credenciales.
Nunca activarlo en un entorno compartido o productivo.
"""
import os
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine
from app.core.sesiones import identificar_token

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Actor:
    id_usuario: int
    rol: str
    permisos: dict | None = None
    acciones: list | None = None


def obtener_actor(
    request: Request,
    x_demo_user_id: int | None = Header(default=None, alias="X-Demo-User-ID"),
    credenciales: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Actor:
    # Compatible también con un middleware que ya verificó la identidad.
    autenticado = getattr(request.state, "usuario_id", None)
    if autenticado is not None:
        usuario_id = autenticado
    elif credenciales is not None:
        usuario_id = identificar_token(credenciales.credentials)
    elif (
        os.getenv("ALMACEN_DEV_MODE", "0") == "1"
        and request.client is not None
        and request.client.host in {"127.0.0.1", "::1", "localhost", "testclient"}
    ):
        usuario_id = x_demo_user_id or int(os.getenv("ALMACEN_DEV_USER_ID", "1"))
    else:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    try:
        with engine.connect() as conexion:
            usuario = conexion.execute(
                text("""
                    SELECT u.id_usuario, r.nombre AS rol,r.permisos,r.acciones
                    FROM usuarios AS u
                    JOIN roles AS r ON r.id_rol = u.id_rol
                    WHERE u.id_usuario = :id
                """),
                {"id": usuario_id},
            ).mappings().first()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="No fue posible validar el usuario") from exc
    if usuario is None:
        raise HTTPException(status_code=401, detail="Usuario no válido")
    actor = Actor(id_usuario=usuario["id_usuario"], rol=usuario["rol"],
                  permisos=usuario['permisos'] if credenciales is not None else None,
                  acciones=usuario['acciones'] if credenciales is not None else None)
    exigir_almacen(actor)
    if credenciales is not None:
        # Las ediciones de permisos en Sistemas también rigen las escrituras de Almacén.
        from app.core.acceso import exigir
        ruta = request.url.path
        permiso = None
        pantallas = []
        if ruta.endswith('/reabrir'):
            pantallas, permiso = ['empaque/consultar-caja'], 'reabrir-caja'
        elif ruta.endswith('/solicitudes-reapertura'):
            pantallas = ['empaque/consultar-caja']
            permiso = 'cerrar-caja' if 'cerrar-caja' in (usuario['acciones'] or []) else 'reabrir-caja'
            # La solicitud se permite desde la consulta, aun cuando esta sea de solo lectura.
        elif ruta.endswith('/cerrar'):
            pantallas, permiso = ['empaque/confirmar-cierre-de-caja', 'embarques/cierre-de-caja-escaneo', 'embarques/confirmacion-de-cierre-de-caja'], 'cerrar-caja'
        elif ruta.endswith('/salida'):
            pantallas, permiso = ['embarques/armar-embarque', 'embarques/paquetes-en-embarcacion'], 'confirmar-salida-de-embarque'
        elif '/embarques' in ruta:
            pantallas = ['embarques/armar-embarque', 'embarques/paquetes-en-embarcacion']
        elif ruta.endswith('/incidencias'):
            pantallas = ['empaque/consultar-caja', 'embarques/cierre-de-caja-escaneo']
        else:
            pantallas = ['empaque/formar-caja']
        permitido = False
        for pantalla in pantallas:
            try:
                exigir(usuario, pantalla, escribir=not ruta.endswith('/solicitudes-reapertura'), accion=permiso)
                permitido = True
                break
            except HTTPException as exc:
                if exc.status_code != 403:
                    raise
        if not permitido:
            raise HTTPException(403, 'Tu rol no tiene permiso para esta operación de Almacén.')
    return actor


def exigir_almacen(actor: Actor) -> None:
    if actor.permisos is not None:
        if not any(p.startswith(('empaque/', 'embarques/')) and v in {'ver', 'acciona'} for p, v in actor.permisos.items()):
            raise HTTPException(403, 'Tu rol no tiene acceso a Almacén.')
        return
    # Calidad y producción no deben poder modificar cajas mediante sus propias cuentas.
    if actor.rol.strip().casefold() not in {
        "administrador", "almacén/empaque", "almacén", "almacen", "empaque", "supervisor de almacén", "supervisor almacen"
    }:
        raise HTTPException(status_code=403, detail="Se requiere rol de Almacén o Administrador")


def exigir_supervisor(actor: Actor) -> None:
    if actor.acciones is not None:
        if 'reabrir-caja' not in actor.acciones:
            raise HTTPException(403, 'Se requiere permiso para reabrir cajas.')
        return
    if actor.rol.strip().casefold() not in {
        "administrador", "supervisor de almacén", "supervisor almacen"
    }:
        raise HTTPException(status_code=403, detail="Se requiere supervisor de Almacén")


def exigir_operador(actor: Actor) -> None:
    if actor.permisos is not None:
        if not any(p.startswith(('empaque/', 'embarques/')) and v == 'acciona' for p, v in actor.permisos.items()):
            raise HTTPException(403, 'Se requiere permiso de escritura en Almacén.')
        return
    if actor.rol.strip().casefold() not in {'administrador', 'almacén/empaque', 'almacén', 'almacen', 'empaque'}:
        raise HTTPException(status_code=403, detail='Se requiere un operador de Almacén para esta acción.')
