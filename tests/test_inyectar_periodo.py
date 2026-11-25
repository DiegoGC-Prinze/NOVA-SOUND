"""Validacion del generador entrante sin tocar Docker ni bases existentes."""
import contextlib
from datetime import date
import importlib.util
import io
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'inyectar_periodo', Path(__file__).resolve().parents[1] / 'scripts/simulacion/inyectar_periodo.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class TestInyectarPeriodo(unittest.TestCase):
    def test_plan_reproducible_con_dos_turnos_por_dia(self):
        a = MOD.planificar(date(2026, 10, 25), date(2026, 11, 25), 3500, 4500, random.Random(20261125))
        b = MOD.planificar(date(2026, 10, 25), date(2026, 11, 25), 3500, 4500, random.Random(20261125))
        self.assertEqual(a, b)
        self.assertEqual(len(a), 32)
        self.assertEqual(a[0][0], date(2026, 10, 25))
        self.assertEqual(a[-1][0], date(2026, 11, 25))
        self.assertTrue(all(t1 > 0 and t2 > 0 and 3500 <= t1+t2 <= 4500 for _, t1, t2 in a))

    def test_sin_aplicar_solo_imprime_el_plan(self):
        with patch.object(MOD, 'ejecutar') as ejecutar, contextlib.redirect_stdout(io.StringIO()):
            MOD.main(['--desde', '2026-11-01', '--hasta', '2026-11-02', '--min-diario', '20', '--max-diario', '30'])
        ejecutar.assert_not_called()

    def test_argumentos_invalidos_no_ejecutan_docker(self):
        for args in (['--base', MOD.ORIGEN], ['--base', 'nova_sounds'],
                     ['--min-diario', '19'], ['--min-diario', '50', '--max-diario', '20'],
                     ['--desde', '2026-11-25', '--hasta', '2026-11-01']):
            with self.subTest(args=args), patch.object(MOD, 'ejecutar') as ejecutar:
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exc:
                    MOD.main(args)
                self.assertEqual(exc.exception.code, 2)
                ejecutar.assert_not_called()

    def test_aplicar_sin_credenciales_no_crea_base(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(MOD, 'ejecutar') as ejecutar:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as exc:
                        MOD.main(['--aplicar', '--env-file', str(Path(folder)/'inexistente.env')])
                self.assertEqual(exc.exception.code, 2)
                ejecutar.assert_not_called()


if __name__ == '__main__':
    unittest.main()
