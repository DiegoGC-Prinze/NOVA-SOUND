"""Contratos de seguridad de Calidad: independientes de PostgreSQL."""
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from app.main import app
from app.modules.calidad.schemas import InspeccionCrear
from app.modules.pruebas import ResultadoCrear


def test_calidad_y_pruebas_requieren_sesion():
    api = TestClient(app)
    for ruta in ['/api/v1/calidad/resumen','/api/v1/calidad/unidades/QA','/api/v1/calidad/defectos','/api/v1/calidad/retenciones','/api/v1/calidad/retrabajos','/api/v1/calidad/reportes','/api/v1/pruebas/operacion']:
        assert api.get(ruta).status_code == 401


def test_inspeccion_rechaza_estado_arbitrario_e_identidad_del_cliente():
    for datos in [dict(disposicion='EMPACADA'),dict(disposicion='LIBERADA',id_usuario=1)]:
        with pytest.raises(ValidationError):
            InspeccionCrear(**datos)


def test_prueba_rechaza_resultado_arbitrario():
    with pytest.raises(ValidationError):
        ResultadoCrear(serie='QA',prueba={'audio':'OK'})
