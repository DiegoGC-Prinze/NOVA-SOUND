"""Pruebas sin Docker para el cliente y escenarios de simulacion."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

DIR=Path(__file__).resolve().parents[1]/'scripts'/'simulacion'
sys.path.insert(0,str(DIR))
from cliente_api import Cliente
from aplicar import leer_env, seleccionar_defecto
from simular import simular


class PruebasSimulacionCompleta(unittest.TestCase):
    def test_no_permite_port_8000_ni_direccion_externa(self):
        for url in ['http://localhost:8000','http://192.168.1.1:8001',
                    'https://localhost:8001','http://localhost:8002']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                Cliente(url,'clave-local')
        self.assertEqual(Cliente('http://127.0.0.1:8001','clave').base,'http://127.0.0.1:8001')

    def test_sin_clave_no_hay_cliente(self):
        with self.assertRaises(ValueError):
            Cliente('http://localhost:8001','')

    def test_config_escenario_3_lineas_30_dias(self):
        cfg=json.loads((DIR/'config_realista.json').read_text())
        r=simular(cfg)
        self.assertEqual(r['resumen']['dias_operativos'],30)
        self.assertEqual(r['resumen']['turnos_simulados'],180)
        self.assertEqual(len({u['linea'] for u in r['unidades']}),3)
        self.assertEqual(len({u['modelo'] for u in r['unidades']}),4)
        self.assertLess(r['resumen']['cumplimiento_meta_pct'],100)
        self.assertGreater(r['resumen']['estados_previstos']['SCRAP'],0)
        self.assertGreater(r['resumen']['incidencias']['PARO_EQUIPO'],0)
        self.assertEqual(r['resumen']['fecha_fin'],'2026-11-25')

    def test_defectos_corresponden_categoria(self):
        cat={'categorias':{'items':[
            {'codigo':'CAT1','nombre':'Apariencia / Estetica'},
            {'codigo':'CAT2','nombre':'Falla Funcional / Componente'}]},
            'defectos':{'items':[
                {'codigo':'CAT1-01','nombre':'Rayon'},
                {'codigo':'CAT2-01','nombre':'Audio intermitente'}]}}
        self.assertEqual(seleccionar_defecto(cat,'APARIENCIA')['defecto'],'Rayon')
        self.assertEqual(seleccionar_defecto(cat,'FUNCIONAL')['defecto'],'Audio intermitente')

    def test_env_sin_guardar_secretos(self):
        with tempfile.TemporaryDirectory() as p:
            f=Path(p)/'.env.simulacion'
            f.write_text('\n'.join(f'{k}=valor' for k in
                ['SIMULACION_KEY','SISTEMAS_USUARIO','SISTEMAS_PASSWORD','SIM_OPERADOR_PASSWORD',
                 'SIM_LIDER_PASSWORD','SIM_CALIDAD_PASSWORD','SIM_ALMACEN_PASSWORD']))
            v=leer_env(f)
            self.assertEqual(v['SIMULACION_KEY'],'valor')


if __name__=='__main__':
    unittest.main()
