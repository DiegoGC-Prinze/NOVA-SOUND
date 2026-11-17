"""Ejecuta todas las suites sin usar el .env ni los datos de la aplicacion."""
from pathlib import Path
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    for stream in [sys.stdout, sys.stderr]:
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    for program in ['docker', 'node']:
        if not shutil.which(program):
            raise SystemExit(f'Falta {program}. Instala Docker Desktop y Node.js 22 o superior.')
    env = os.environ.copy()
    # El entorno del usuario no debe sustituir las credenciales de pruebas.
    for name in ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'APP_PORT', 'ALMACEN_RUN_INTEGRATION', 'ALMACEN_TEST_DB_NAME', 'SISTEMAS_USUARIO', 'SISTEMAS_NOMBRE', 'SISTEMAS_PASSWORD']:
        env.pop(name, None)
    version = subprocess.check_output(['node', '-p', 'process.versions.node'], text=True).strip()
    if int(version.split('.')[0]) < 22:
        raise SystemExit('Se requiere Node.js 22 o superior.')
    os_type = subprocess.check_output(['docker', 'info', '--format', '{{.OSType}}'], env=env, text=True).strip()
    if os_type != 'linux':
        raise SystemExit('Docker Desktop debe estar configurado para contenedores Linux.')
    browsers = [env['NOVA_TEST_BROWSER']] if env.get('NOVA_TEST_BROWSER') else [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]
    browser = next((p for p in browsers if Path(p).is_file()), None)
    if not browser:
        raise SystemExit('Se requiere Edge/Chrome. Puedes indicar su ruta mediante NOVA_TEST_BROWSER.')
    env['NOVA_TEST_BROWSER'] = str(browser)
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    if port == 8000:
        raise SystemExit('No se selecciono un puerto aislado; vuelve a ejecutar el comando.')
    project = 'nova-test-' + uuid.uuid4().hex[:10]
    folder = Path(tempfile.mkdtemp(prefix=project+'-'))
    env_file = folder/'pruebas.env'
    password_sistemas = secrets.token_urlsafe(24)
    env_file.write_text(f'DB_NAME=nova_sounds\nDB_USER=nova_test\nDB_PASSWORD={secrets.token_urlsafe(32)}\nAPP_PORT={port}\nSISTEMAS_USUARIO=sistemas\nSISTEMAS_NOMBRE=Sistemas\nSISTEMAS_PASSWORD={password_sistemas}\n', encoding='utf-8')
    fixture_file = folder/'fixture.json'
    compose = ['docker', 'compose', '-f', str(ROOT/'compose.yaml'), '--env-file', str(env_file), '--project-name', project]
    image = project+'-tests'
    started = time.monotonic()
    results = []
    creation_attempted = False
    failed = False
    log = (folder/'ejecucion.log').open('w', encoding='utf-8')

    def run(label, command, capture=False, input_text=None):
        print(f'\n{label}', flush=True)
        log.write('\n'+label+'\n'); log.flush()
        before = time.monotonic()
        r = subprocess.run(command, cwd=ROOT, env=env, input=input_text, text=True,
                           encoding='utf-8', errors='replace', stdout=subprocess.PIPE if capture else None,
                           stderr=subprocess.PIPE if capture else None)
        results.append({'paso': label, 'ok': r.returncode == 0, 'segundos': round(time.monotonic()-before, 1)})
        log.write(json.dumps(results[-1], ensure_ascii=False)+'\n'); log.flush()
        if r.returncode:
            # El stdout capturado del bootstrap puede incluir credenciales QA.
            if capture and r.stderr:
                print(r.stderr)
                log.write(r.stderr)
            raise RuntimeError(f'Fallo: {label} (codigo {r.returncode}).')
        return r.stdout if capture else None

    try:
        print(f'Entorno aislado: {project}\nPuerto de pruebas: {port}\nLa aplicacion del puerto 8000 no se modifica.\nResultados: {folder}', flush=True)
        run('1. Cliente HTTP de Almacen', ['node', '--test', 'frontend/integraciones/almacenApi.test.mjs'])
        run('2. Validar Compose de pruebas', compose+['config', '--quiet'])
        creation_attempted = True
        run('3. Iniciar PostgreSQL y API aislados', compose+['up', '-d', '--build', '--wait', '--wait-timeout', '180'])
        run('4. Construir imagen de pruebas del backend', ['docker', 'build', '--target', 'test', '-f', 'backend/Dockerfile', '-t', image, '.'])
        sql_files = ' '.join('/docker-entrypoint-initdb.d/'+name for name in [
            '010_esquema.sql', '020_datos_demo.sql', '040_almacen.sql', '050_modelos.sql', '060_integracion_frontend.sql', '070_gestion.sql', '080_calidad_pruebas.sql'])
        prepare = 'createdb -U "$POSTGRES_USER" nova_sounds_test && for script in '+sql_files+'; do psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d nova_sounds_test -f "$script" > /dev/null || exit 1; done'
        run('5. Preparar base separada de integracion', compose+['exec', '-T', 'db', 'sh', '-c', prepare])
        container = ['docker', 'run', '--rm', '--env-file', str(env_file), '--network', project+'_default', '-e', 'DB_HOST=db', '-e', 'DB_PORT=5432', '-e', 'PYTHONPATH=/app/backend']
        run('6. Backend completo, incluidas pruebas PostgreSQL', container+['-e', 'ALMACEN_RUN_INTEGRATION=1', '-e', 'ALMACEN_TEST_DB_NAME=nova_sounds_test', image])
        fixture = {'entorno': 'pruebas', 'baseURL': f'http://localhost:{port}/',
                   'usuario': 'qa_almacen_web', 'password': secrets.token_urlsafe(24),
                   'supervisor': 'qa_supervisor_web', 'passwordSupervisor': secrets.token_urlsafe(24),
                   'admin': 'qa_admin_web', 'passwordAdmin': secrets.token_urlsafe(24),
                   'passwordGeneral': secrets.token_urlsafe(24),
                   'sistemas': 'sistemas', 'passwordSistemas': password_sistemas,
                   'serie': 'QA-WEB-LIBERADA', 'serieRetenida': 'QA-WEB-RETENIDA'}
        bootstrap = container+['-i', '-e', 'NOVA_ISOLATED_TESTS=1', '-e', 'NOVA_TEST_PROJECT='+project, image, 'python', 'tests/preparar_fixture_web.py']
        content = run('7. Preparar cuentas y registros QA privados', bootstrap, capture=True, input_text=json.dumps(fixture))
        fixture = json.loads(content)
        fixture_file.write_text(json.dumps(fixture), encoding='utf-8')
        run('8. Frontend de demostracion y 41 pantallas', ['node', 'frontend/tests/frontend.test.mjs'])
        run('9. Frontend real con PostgreSQL y 13 pantallas de Almacen', ['node', 'frontend/tests/almacen-real.test.mjs', str(fixture_file)])
        run('9b. Produccion, cierres, Gerencia y Sistemas en navegador real', ['node', 'frontend/tests/gestion-real.test.mjs', str(fixture_file)])
        run('9c. Verificar migracion 07 reejecutable con datos existentes', compose+['exec', '-T', 'db', 'sh', '-c', 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/070_gestion.sql > /dev/null'])
        run('9d. Verificar migracion 08 sin sobrescribir permisos de Calidad', compose+['exec', '-T', 'db', 'sh', '-c', 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/080_calidad_pruebas.sql > /dev/null'])
        run('10. Verificar resultado final directamente en SQL', bootstrap+['--verificar'], input_text=json.dumps(fixture))
    except (RuntimeError, subprocess.SubprocessError, OSError, ValueError) as exc:
        failed = True
        print('\n'+str(exc), file=sys.stderr)
    except KeyboardInterrupt:
        failed = True
        print('\nPruebas interrumpidas. Retirando el entorno temporal.', file=sys.stderr)
    finally:
        if creation_attempted:
            print('\nRetirando unicamente los recursos temporales de esta corrida...', flush=True)
            volume = project+'_postgres_data'
            inspect = subprocess.run(['docker', 'volume', 'inspect', volume, '--format', '{{json .Labels}}'], env=env, capture_output=True, text=True)
            remove_volumes = False
            if inspect.returncode == 0:
                try:
                    remove_volumes = json.loads(inspect.stdout).get('com.docker.compose.project') == project
                except (ValueError, AttributeError):
                    pass
            down = subprocess.run(compose+['down']+(['--volumes'] if remove_volumes else []), cwd=ROOT, env=env)
            if down.returncode:
                failed = True
                print('No se pudo completar la limpieza; revisa el proyecto '+project, file=sys.stderr)
            subprocess.run(['docker', 'image', 'rm', image, project+'-app'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for private in [env_file, fixture_file]:
            private.unlink(missing_ok=True)
        summary = {'ok': not failed, 'proyecto_temporal': project, 'segundos': round(time.monotonic()-started, 1), 'pasos': results}
        (folder/'resultado.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        log.close()
    print('\n'+('TODAS LAS PRUEBAS PASARON.' if not failed else 'HUBO PRUEBAS FALLIDAS.'), flush=True)
    print('Resumen: '+str(folder/'resultado.json'))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
