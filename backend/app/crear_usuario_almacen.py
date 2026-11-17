"""Alta explicita: docker compose exec app python -m app.crear_usuario_almacen."""
import argparse
import getpass

from sqlalchemy import text
from app.core.sesiones import hash_password
from app.db.database import engine


def main():
    parser = argparse.ArgumentParser(description='Crear cuenta de Almacén sin modificar cuentas existentes.')
    parser.add_argument('--usuario', required=True)
    parser.add_argument('--nombre', required=True)
    parser.add_argument('--rol', choices=['almacen', 'supervisor'], default='almacen')
    args = parser.parse_args()
    usuario, nombre = args.usuario.strip(), args.nombre.strip()
    if not 1 <= len(usuario) <= 50 or not 1 <= len(nombre) <= 100:
        parser.error('Usuario: 1-50 caracteres. Nombre: 1-100 caracteres.')
    password = getpass.getpass('Contraseña nueva (mínimo 8 caracteres): ')
    if len(password) < 8 or len(password) > 255 or password != getpass.getpass('Repetir contraseña: '):
        parser.error('La contraseña debe tener 8-255 caracteres y ambas capturas deben coincidir.')
    rol = 'Almacén/Empaque' if args.rol == 'almacen' else 'Supervisor de almacén'
    with engine.begin() as cx:
        cx.execute(text('LOCK TABLE usuarios IN SHARE ROW EXCLUSIVE MODE'))
        if cx.execute(text('SELECT 1 FROM usuarios WHERE usuario=:usuario'), {'usuario': usuario}).first():
            parser.error('Ese usuario ya existe. No se modificó su cuenta.')
        id_rol = cx.execute(text('SELECT id_rol FROM roles WHERE nombre=:rol ORDER BY id_rol LIMIT 1'), {'rol': rol}).scalar_one()
        cx.execute(text('INSERT INTO usuarios(id_rol,nombre,usuario,contrasena) VALUES (:rol,:nombre,:usuario,:hash)'),
                   {'rol': id_rol, 'nombre': nombre, 'usuario': usuario, 'hash': hash_password(password)})
    print(f'Usuario {usuario} creado con rol {rol}.')


if __name__ == '__main__':
    main()
