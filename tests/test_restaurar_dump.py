"""Pruebas del restaurador sin acceder a la base principal ni a Docker."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'restaurar_dump', Path(__file__).resolve().parents[1] / 'scripts/restaurar_dump.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class DockerFalso:
    def __init__(self, fallo=None):
        self.calls = []
        self.fallo = fallo

    def run(self, args, label, **kwargs):
        self.calls.append(args)
        if args[0] == 'cp' and args[1].startswith('db:'):
            if self.fallo == 'backup':
                raise RuntimeError('No hay espacio para guardar el respaldo')
            Path(args[2]).write_bytes(b'PGDMP-respaldo-anterior')
        if 'pg_restore' in args and '--list' in args:
            return '; Archive\n1; 1259 123 TABLE public usuarios postgres'
        return ''

    def database(self, program, *args):
        self.calls.append([program, *args])
        if self.fallo == 'restore' and program == 'pg_restore':
            raise RuntimeError('Error de PostgreSQL')
        return ''


class TestRestaurarDump(unittest.TestCase):
    def ejecutar(self, docker, verificar=False, confirmar=True):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            dump = root / 'entrada.dump'
            dump.write_bytes(b'PGDMP-entrada')
            with patch.object(MOD, 'validar', return_value=('destino_env', 'usuario_env', 'abc123', True)):
                with contextlib.redirect_stdout(io.StringIO()):
                    MOD.restaurar(docker, dump, root / 'respaldos', verificar, confirmar)

    def test_verificar_no_pausa_app_ni_restaura(self):
        docker = DockerFalso()
        self.ejecutar(docker, verificar=True)
        self.assertFalse(any(c[0] in ('stop', 'start', 'pg_dump', 'pg_restore') for c in docker.calls))
        self.assertEqual(docker.calls[-1][:4], ['exec', '-T', 'db', 'rm'])

    def test_respaldo_se_guarda_antes_de_restaurar_y_reinicia_app(self):
        docker = DockerFalso()
        self.ejecutar(docker)
        restore = next(c for c in docker.calls if c[0] == 'pg_restore')
        self.assertTrue({'--clean', '--if-exists', '--single-transaction', '--exit-on-error',
                         '--no-owner', '--no-privileges'}.issubset(restore))
        self.assertNotIn('--create', restore)
        backup = next(c for c in docker.calls if c[0] == 'cp' and c[1].startswith('db:'))
        self.assertLess(docker.calls.index(backup), docker.calls.index(restore))
        self.assertEqual(docker.calls[-1], ['start', '--wait', '--wait-timeout', '90', 'app'])

    def test_respaldo_fallido_impide_restore_y_recupera_app(self):
        docker = DockerFalso('backup')
        with self.assertRaisesRegex(RuntimeError, 'respaldo'):
            self.ejecutar(docker)
        self.assertFalse(any(c[0] == 'pg_restore' for c in docker.calls))
        self.assertEqual(docker.calls[-1], ['start', '--wait', '--wait-timeout', '90', 'app'])

    def test_restore_fallido_recupera_app(self):
        docker = DockerFalso('restore')
        with self.assertRaisesRegex(RuntimeError, 'PostgreSQL'):
            self.ejecutar(docker)
        self.assertEqual(docker.calls[-1], ['start', '--wait', '--wait-timeout', '90', 'app'])

    def test_cancelar_no_detiene_app(self):
        docker = DockerFalso()
        with patch('builtins.input', return_value='cancelar'), patch.object(MOD.sys.stdin, 'isatty', return_value=True):
            self.ejecutar(docker, confirmar=False)
        self.assertFalse(any(c[0] in ('stop', 'start', 'pg_dump', 'pg_restore') for c in docker.calls))

    def test_password_no_se_pasa_como_argumento(self):
        compose = MOD.Compose(Path('pruebas.env'), 'pruebas')
        with patch.object(compose, 'run', return_value='') as run:
            compose.database('psql', '-Atc', 'SELECT 1')
        command = run.call_args.args[0]
        self.assertIn('export PGPASSWORD="$POSTGRES_PASSWORD"', command[5])
        self.assertIn('"$POSTGRES_DB"', command[5])

    def test_validar_password_con_dolares_y_espacios(self):
        compose = MOD.Compose(Path('pruebas.env'), 'pruebas')
        password = ' clave$$# con espacios '
        config = {'services': {'db': {'environment': {
            'POSTGRES_DB': 'destino', 'POSTGRES_USER': 'usuario',
            'POSTGRES_PASSWORD': password.replace('$', '$$')}}}}
        responses = [json.dumps(config), 'container-id',
                     f'destino\0usuario\0{password}\0', 'app-id']
        with patch.object(compose, 'run', side_effect=responses), patch.object(compose, 'database'):
            self.assertEqual(MOD.validar(compose), ('destino', 'usuario', 'container-id', True))
        self.assertIn(password, compose.secrets)


if __name__ == '__main__':
    unittest.main()
