"""Restaura un dump de PostgreSQL usando Docker Compose y el .env de la raiz."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DUMP = ROOT / 'database/demo/nova_sound_presentacion.dump'


class Compose:
    def __init__(self, env_file, proyecto):
        self.env = os.environ.copy()
        # Compose debe tomar los valores del archivo, no de otra sesion de terminal.
        variables = re.findall(r'\$\{([A-Z_][A-Z_0-9]*)', (ROOT / 'compose.yaml').read_text(encoding='utf-8'))
        for key in [*variables, 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES']:
            self.env.pop(key, None)
        self.command = ['docker', 'compose', '--project-name', proyecto,
                        '--env-file', str(env_file), '-f', str(ROOT / 'compose.yaml')]
        self.secrets = []

    def run(self, args, label, *, check=True):
        result = subprocess.run(self.command + args, cwd=ROOT, env=self.env,
                                capture_output=True, text=True, encoding='utf-8', errors='replace')
        if check and result.returncode:
            message = result.stderr.strip()
            for secret in self.secrets:
                message = message.replace(secret, '***')
            # Los errores de interpolacion pueden contener lineas del .env.
            if args[0] == 'config':
                message = 'Revisa las variables requeridas en el .env y que Docker Compose este instalado.'
            raise RuntimeError(f'{label}: {message or "el comando fallo"}')
        return result.stdout.strip()

    def database(self, program, *args):
        # La clave se expande dentro del contenedor y nunca va en la linea de comandos.
        command = ('export PGPASSWORD="$POSTGRES_PASSWORD"; '
                   'exec "$@" -h 127.0.0.1 -w -U "$POSTGRES_USER" -d "$POSTGRES_DB"')
        return self.run(['exec', '-T', 'db', 'sh', '-c', command, 'restaurar-dump', program, *args],
                        f'Fallo {program}')


def validar(compose):
    config = json.loads(compose.run(['config', '--format', 'json'], 'Configuracion de Compose'))
    # `compose config` duplica los signos $ al serializar valores interpolados.
    expected = {key: str(value).replace('$$', '$')
                for key, value in config['services']['db']['environment'].items()}
    compose.secrets = [secret for service in config['services'].values()
                       for key, v in service.get('environment', {}).items()
                       if 'PASSWORD' in key and v
                       for secret in (str(v), str(v).replace('$$', '$'))]
    container = compose.run(['ps', '-q', 'db'], 'Buscar PostgreSQL')
    if not container or '\n' in container:
        raise RuntimeError('Debe existir un unico servicio db en ejecucion. Inicialo con docker compose up -d db.')
    actual = compose.run(['exec', '-T', 'db', 'sh', '-c',
                          'printf "%s\\0" "$POSTGRES_DB" "$POSTGRES_USER" "$POSTGRES_PASSWORD"'],
                         'Validar el entorno de PostgreSQL').split('\0')[:-1]
    wanted = [str(expected[key]) for key in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD')]
    if actual != wanted:
        raise RuntimeError('El contenedor db no coincide con el .env. Revisa su configuracion antes de restaurar.')
    compose.database('psql', '-X', '-v', 'ON_ERROR_STOP=1', '-Atc', 'SELECT 1')
    app_running = bool(compose.run(['ps', '--status', 'running', '-q', 'app'], 'Consultar app'))
    return expected['POSTGRES_DB'], expected['POSTGRES_USER'], container, app_running


def restaurar(compose, dump, destino, verificar, confirmar):
    database, user, container, app_running = validar(compose)
    print(f'Archivo: {dump}\nContenedor db: {container[:12]}\nBase: {database}\nUsuario: {user}', flush=True)
    token = uuid.uuid4().hex
    remote_dump = f'/tmp/nova-restaurar-{token}.dump'
    remote_backup = f'/tmp/nova-antes-{token}.dump'
    stopped = False
    try:
        compose.run(['cp', str(dump), f'db:{remote_dump}'], 'Copiar dump al contenedor')
        listing = compose.run(['exec', '-T', 'db', 'pg_restore', '--list', remote_dump], 'Validar formato del dump')
        if not any(line and not line.startswith(';') for line in listing.splitlines()):
            raise RuntimeError('El dump no contiene objetos para restaurar.')
        if verificar:
            print('Verificacion correcta: conexion y archivo compatibles. No se modifico la base.')
            return

        print('\nSe reemplazaran los objetos y datos incluidos en el dump dentro de esta base.')
        if not confirmar:
            if not sys.stdin.isatty():
                raise RuntimeError('Ejecuta en una terminal interactiva o usa --si para confirmar la restauracion.')
            if input(f'Escribe RESTAURAR {database} para continuar: ').strip() != f'RESTAURAR {database}':
                print('Restauracion cancelada.')
                return

        destino.mkdir(parents=True, exist_ok=True)
        backup = destino / f'antes_restaurar_{datetime.now():%Y%m%d_%H%M%S}_{token[:8]}.dump'
        if app_running:
            # Marcar antes del comando permite intentar reiniciar incluso si se interrumpe stop.
            stopped = True
            compose.run(['stop', 'app'], 'Pausar la aplicacion')
        print('Creando respaldo de la base actual...', flush=True)
        compose.database('pg_dump', '--format=custom', '--no-owner', '--no-privileges', '--file', remote_backup)
        compose.run(['cp', f'db:{remote_backup}', str(backup)], 'Guardar respaldo local')
        with backup.open('rb') as stream:
            if stream.read(5) != b'PGDMP':
                raise RuntimeError('No se pudo verificar el respaldo local. No se iniciara la restauracion.')
        print(f'Respaldo guardado: {backup}\nRestaurando...', flush=True)
        # Sin --create: el nombre de destino siempre procede del .env, no del dump.
        # Una sola transaccion revierte los cambios si PostgreSQL encuentra un error.
        compose.database('pg_restore', '--clean', '--if-exists', '--no-owner', '--no-privileges',
                         '--single-transaction', '--exit-on-error', remote_dump)
        print('Restauracion completada.', flush=True)
    finally:
        try:
            compose.run(['exec', '-T', 'db', 'rm', '-f', remote_dump, remote_backup],
                        'Limpiar archivos temporales', check=False)
        finally:
            if stopped:
                compose.run(['start', '--wait', '--wait-timeout', '90', 'app'], 'Reiniciar la aplicacion')
                print('Aplicacion iniciada. Vuelve a iniciar sesion en el navegador.', flush=True)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dump', nargs='?', type=Path, default=DEFAULT_DUMP,
                        help='Ruta del .dump; por defecto database/demo/nova_sound_presentacion.dump')
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env', help='Archivo .env de Docker')
    parser.add_argument('--proyecto', default='nova-sound', help='Proyecto de Compose (principal: nova-sound)')
    parser.add_argument('--respaldos', type=Path, default=ROOT / 'respaldos', help='Carpeta del respaldo previo')
    parser.add_argument('--verificar', action='store_true', help='Validar conexion y dump sin restaurar')
    parser.add_argument('--si', action='store_true', help='Confirmar reemplazo sin pregunta interactiva')
    args = parser.parse_args(argv)
    try:
        if not shutil.which('docker'):
            raise RuntimeError('Instala Docker Desktop e inicialo antes de ejecutar el script.')
        if not args.env_file.is_file():
            raise RuntimeError(f'No existe el archivo de configuracion: {args.env_file}')
        dump = args.dump.resolve()
        with dump.open('rb') as stream:
            if stream.read(5) != b'PGDMP':
                raise RuntimeError('Se requiere un dump de pg_dump --format=custom (PGDMP). No un .sql ni un .gpg.')
        print(f'Proyecto: {args.proyecto}\nConfiguracion: {args.env_file.resolve()}', flush=True)
        compose = Compose(args.env_file.resolve(), args.proyecto)
        restaurar(compose, dump, args.respaldos.resolve(), args.verificar, args.si)
        return 0
    except (OSError, RuntimeError, ValueError, KeyError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print('\nOperacion interrumpida. Revisa el estado con docker compose ps.', file=sys.stderr)
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
