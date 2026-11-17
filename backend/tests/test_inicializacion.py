"""Contrato de inicialización durante el arranque de FastAPI."""
import pytest
from fastapi.testclient import TestClient
from app import main


def test_arranque_inicializa_sistemas_con_configuracion(monkeypatch):
    llamadas = []
    monkeypatch.setenv('SISTEMAS_USUARIO', 'sistemas-test')
    monkeypatch.setenv('SISTEMAS_NOMBRE', 'Sistemas Test')
    monkeypatch.setenv('SISTEMAS_PASSWORD', 'ClaveSoloDePruebas')
    monkeypatch.setattr(main, 'crear_sistemas_inicial', lambda engine, **kwargs: llamadas.append(kwargs))
    with TestClient(main.app) as api:
        assert api.get('/api/v1').status_code == 200
    assert llamadas == [dict(usuario='sistemas-test', nombre='Sistemas Test', password='ClaveSoloDePruebas')]


def test_arranque_no_oculta_fallos_de_inicializacion(monkeypatch):
    def fallar(*args, **kwargs):
        raise RuntimeError('Configuración inicial incompleta')
    monkeypatch.setattr(main, 'crear_sistemas_inicial', fallar)
    with pytest.raises(RuntimeError, match='Configuración inicial incompleta'):
        with TestClient(main.app):
            pass
