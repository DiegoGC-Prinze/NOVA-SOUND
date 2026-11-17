"""Crea la cuenta inicial de Sistemas una sola vez, también con volúmenes existentes."""
import json
import logging
import re

from sqlalchemy import text
from app.core.acceso import CONTRATOS, ADMINISTRAR
from app.core.sesiones import hash_password

log = logging.getLogger(__name__)
MARCADOR = 'usuario-sistemas-inicial-v1'
PERMISOS = {'login/login': 'acciona', 'login/levantar-ticket': 'acciona',
            **{p['id']: 'acciona' for p in CONTRATOS['pantallas'] if p['area'] == 'sistemas'}}


def crear_sistemas_inicial(db_engine, *, usuario='sistemas', nombre='Sistemas', password=''):
    """No cambia contraseñas, estados ni permisos cuando ya se completó el alta inicial."""
    with db_engine.begin() as cx:
        cx.execute(text("SET LOCAL TIME ZONE 'America/Mexico_City'"))
        # Mismo bloqueo que la administración de usuarios y roles desde Sistemas.
        cx.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('administracion-usuarios-roles',0))"))
        if cx.execute(text('SELECT 1 FROM configuracion_web WHERE clave=:clave'), {'clave': MARCADOR}).first():
            return False
        usuario, nombre = usuario.strip(), nombre.strip()
        if not re.fullmatch(r'[\w.@-]{1,50}', usuario) or not 1 <= len(nombre) <= 100:
            raise RuntimeError('SISTEMAS_USUARIO o SISTEMAS_NOMBRE no válidos.')
        cx.execute(text('LOCK TABLE usuarios,roles IN SHARE ROW EXCLUSIVE MODE'))
        existentes = cx.execute(text('''SELECT u.id_usuario,r.nombre AS rol FROM usuarios u JOIN roles r USING(id_rol)
            WHERE u.usuario=:usuario'''), {'usuario': usuario}).mappings().all()
        if existentes and (len(existentes) != 1 or existentes[0]['rol'] != 'Sistemas'):
            raise RuntimeError('SISTEMAS_USUARIO ya existe con otro rol. Elige otro identificador; no se modificó esa cuenta.')
        creado = not existentes
        if creado:
            if not 8 <= len(password) <= 255 or not password.strip():
                raise RuntimeError('Define SISTEMAS_PASSWORD con entre 8 y 255 caracteres para crear la cuenta inicial.')
            roles = cx.execute(text("SELECT id_rol FROM roles WHERE nombre='Sistemas' ORDER BY id_rol")).scalars().all()
            if len(roles) > 1:
                raise RuntimeError('Hay roles Sistemas duplicados; revisa el catálogo antes de iniciar.')
            if roles:
                rid = roles[0]
            else:
                rid = cx.execute(text('''INSERT INTO roles(nombre,descripcion,permisos,acciones)
                    VALUES ('Sistemas','Administra usuarios, roles, catálogos, parámetros y tickets.',
                            CAST(:p AS jsonb),CAST(:a AS jsonb)) RETURNING id_rol'''),
                    {'p': json.dumps(PERMISOS), 'a': json.dumps([ADMINISTRAR])}).scalar_one()
            uid = cx.execute(text('''INSERT INTO usuarios(id_rol,nombre,usuario,contrasena,estado,activo)
                VALUES (:rol,:nombre,:usuario,:hash,'Activo',TRUE) RETURNING id_usuario'''),
                {'rol': rid, 'nombre': nombre, 'usuario': usuario, 'hash': hash_password(password)}).scalar_one()
            cx.execute(text('''INSERT INTO bitacora_general(id_usuario,id_registro_afectado,accion,tabla_afectada,motivo)
                VALUES (:id,:id,'CREAR_USUARIO_INICIAL','usuarios','Alta inicial de Sistemas durante el arranque')'''), {'id': uid})
        else:
            uid = existentes[0]['id_usuario']
        cx.execute(text('''INSERT INTO configuracion_web(clave,valor,motivo)
            VALUES (:clave,CAST(:datos AS jsonb),'Inicialización de Sistemas completada; no reiniciar credenciales')'''),
            {'clave': MARCADOR, 'datos': json.dumps({'id_usuario': uid, 'usuario': usuario})})
    # No registrar la contraseña ni su hash en logs o en el marcador.
    log.info('Inicialización de Sistemas completada. Cuenta creada: %s', creado)
    return creado
