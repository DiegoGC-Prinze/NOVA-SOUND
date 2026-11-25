import copy
import json
import unittest
from pathlib import Path
import importlib.util

BASE = Path(__file__).resolve().parents[1]
P = BASE / "scripts" / "simulacion" / "simular.py"
SPEC = importlib.util.spec_from_file_location("simular", P)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
CFG = json.loads((BASE / "scripts" / "simulacion" / "config.json").read_text(encoding="utf-8"))


class TestSimulacion(unittest.TestCase):
    def test_reproducibilidad(self):
        a, b = MOD.simular(CFG), MOD.simular(CFG)
        self.assertEqual(a, b)

    def test_integridad_y_dias(self):
        datos = MOD.simular(CFG)
        r = datos["resumen"]
        self.assertEqual(r["dias_operativos"], 30)
        self.assertEqual(r["turnos_simulados"], 30 * 2 * 2)
        self.assertEqual(sum(r["estados_previstos"].values()), r["producidas"])
        self.assertEqual(len(set(u["numero_serie"] for u in datos["unidades"])), r["producidas"])
        self.assertLess(r["cumplimiento_meta_pct"], 100)
        self.assertGreater(r["producidas"], 100)

    def test_rechaza_pesos_invalidos(self):
        cfg = copy.deepcopy(CFG)
        cfg["modelos"][0]["peso"] = 0.10
        with self.assertRaises(ValueError):
            MOD.simular(cfg)

    def test_diferente_semilla(self):
        self.assertNotEqual(MOD.simular(CFG, semilla=1)["unidades"], MOD.simular(CFG, semilla=2)["unidades"])


if __name__ == "__main__":
    unittest.main()
