"""Datos efimeros para el ejecutor de pruebas; nunca se usa sobre la app real."""
import json
import os
import sys
from urllib.parse import urlparse

from sqlalchemy import text
from app.core.sesiones import hash_password
from app.db.database import engine


def main():
    if os.getenv('NOVA_ISOLATED_TESTS') != '1' or not os.getenv('NOVA_TEST_PROJECT', '').startswith('nova-test-'):
        raise SystemExit('Este comando solo se ejecuta mediante scripts/probar_todo.py.')
    fixture = json.load(sys.stdin)
    url = urlparse(fixture['baseURL'])
    if fixture.get('entorno') != 'pruebas' or url.hostname not in ['localhost', '127.0.0.1'] or url.port in [None, 8000]:
        raise SystemExit('Se requiere un entorno local aislado, en un puerto diferente de 8000.')
    with engine.begin() as cx:
        def scalar(sql, **params):
            return cx.execute(text(sql), params).scalar_one()
        if scalar('SELECT current_database()') != 'nova_sounds':
            raise SystemExit('Base inesperada para el entorno efimero.')
        if '--verificar' in sys.argv:
            row = cx.execute(text('''
                SELECT u.estado,c.estado AS caja,e.estado AS embarque,e.destino,e.contenedor
                FROM unidades u JOIN cajas c ON c.id_caja=u.id_caja
                JOIN embarques e ON e.id_embarque=c.id_embarque
                WHERE u.numero_serie=:serie
            '''), {'serie': fixture['serie']}).mappings().one()
            assert row['estado'] == row['caja'] == 'EMBARCADA'
            assert row['embarque'] == 'ENVIADO'
            assert row['destino'] == 'Destino QA real' and row['contenedor'] == 'CONT-QA-REAL'
            produccion = cx.execute(text("SELECT id_unidad,estado,id_caja FROM unidades WHERE numero_serie IN ('QA-PROD-WEB-001','QA-PROD-WEB-002')")).mappings().all()
            assert len(produccion) == 2 and all(u['estado'] == 'ENSAMBLADA' and u['id_caja'] is None for u in produccion)
            for u in produccion:
                assert scalar('SELECT count(*) FROM pruebas WHERE id_unidad=:id', id=u['id_unidad']) == 0
                assert scalar('SELECT count(*) FROM calidad WHERE id_unidad=:id', id=u['id_unidad']) == 0
            assert scalar("SELECT count(*) FROM autorizacion WHERE tipo_referencia='PRODUCCION_WEB' AND estado='Aprobada'") >= 1
            assert not cx.execute(text('SELECT 1 FROM catalogos_web WHERE id_original IS NOT NULL GROUP BY tipo,id_original HAVING count(*)>1')).first()
            permisos = scalar("SELECT permisos FROM roles WHERE nombre='Gerente de Planta' LIMIT 1")
            assert 'gerencia/autorizaciones' not in permisos, 'La migración no debe sobrescribir permisos editados.'
            full = cx.execute(text('''SELECT u.id_unidad,u.estado,c.estado AS caja,e.estado AS embarque,e.contenedor
                FROM unidades u JOIN cajas c USING(id_caja) JOIN embarques e USING(id_embarque)
                WHERE u.numero_serie='QA-FULL-WEB-001' ''')).mappings().one()
            assert full['estado'] == full['caja'] == 'EMBARCADA' and full['embarque'] == 'ENVIADO'
            assert full['contenedor'] == 'CONT-QA-FULL'
            assert scalar('SELECT count(*) FROM pruebas WHERE id_unidad=:id',id=full['id_unidad']) == 2
            assert scalar("SELECT count(*) FROM retrabajo WHERE id_unidad=:id AND resultado='Corregido'",id=full['id_unidad']) == 1
            assert scalar("SELECT count(*) FROM calidad WHERE id_unidad=:id AND estado='LIBERADA'",id=full['id_unidad']) == 1
            assert 'calidad/reportes-de-calidad' not in scalar("SELECT permisos FROM roles WHERE nombre='Inspector de Calidad' LIMIT 1")
            assert scalar('SELECT count(*) FROM usuarios u JOIN roles r USING(id_rol) WHERE u.usuario=:u AND r.nombre=\'Sistemas\'',u=fixture['sistemas']) == 1
            assert scalar("SELECT count(*) FROM usuarios WHERE usuario='qa_sistemas_operador_web'") == 1
            print('SQL verificado: embarque enviado; producción, incidencia y reapertura persistidas; unidades nuevas sin pruebas ni inspecciones inventadas.')
            return
        ids = []
        for key, password, role in [('usuario', 'password', 'Almacén/Empaque'), ('supervisor', 'passwordSupervisor', 'Supervisor de almacén'), ('admin', 'passwordAdmin', 'Administrador')]:
            if cx.execute(text('SELECT 1 FROM usuarios WHERE usuario=:usuario'), {'usuario': fixture[key]}).first():
                raise SystemExit('La cuenta QA ya existe; se requiere un volumen nuevo de pruebas.')
            rid = scalar('SELECT id_rol FROM roles WHERE nombre=:nombre ORDER BY id_rol LIMIT 1', nombre=role)
            ids.append(scalar('''INSERT INTO usuarios(id_rol,nombre,usuario,contrasena)
                VALUES (:rol,:nombre,:usuario,:hash) RETURNING id_usuario''',
                rol=rid, nombre=fixture[key], usuario=fixture[key], hash=hash_password(fixture[password])))
        cliente = scalar("INSERT INTO clientes(nombre,mezcla_colores) VALUES ('Cliente QA Web',FALSE) RETURNING id_cliente")
        modelo = scalar("SELECT id_modelo FROM modelos WHERE nombre='NS-MINI'")
        color = scalar('SELECT id_color FROM colores ORDER BY id_color LIMIT 1')
        linea = scalar('SELECT id_linea FROM linea ORDER BY id_linea LIMIT 1')
        turno = scalar('SELECT id_turno FROM turnos ORDER BY id_turno LIMIT 1')
        orden = scalar('''INSERT INTO ordenes(id_cliente,id_modelo,id_color,id_linea,cantidad)
            VALUES (:c,:m,:co,:l,20) RETURNING id_orden''', c=cliente, m=modelo, co=color, l=linea)
        lote = scalar("INSERT INTO lote(id_orden,cantidad_acordada,estado) VALUES (:o,20,'EN_PROCESO') RETURNING id_lote", o=orden)
        for serie, estado in [(fixture['serie'], 'LIBERADA'), (fixture['serieRetenida'], 'EN_RETENCION')]:
            unidad = scalar('''INSERT INTO unidades(id_color,id_linea,id_turno,id_lote,estado,numero_serie)
                VALUES (:c,:l,:t,:lo,:e,:s) RETURNING id_unidad''', c=color, l=linea, t=turno, lo=lote, e=estado, s=serie)
            cx.execute(text('INSERT INTO calidad(id_unidad,id_usuario,estado) VALUES (:u,:a,:e)'), {'u': unidad, 'a': ids[0], 'e': estado})
        fixture['orden'] = orden
    print(json.dumps(fixture, ensure_ascii=True))


if __name__ == '__main__':
    main()
