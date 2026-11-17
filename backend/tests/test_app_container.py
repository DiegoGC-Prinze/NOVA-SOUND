"""Contratos de arranque y del servidor compartido, sin conectar a una base real."""
from contextlib import contextmanager
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app import main
from app.db.database import Base, SessionLocal


def test_base_y_sesion_disponibles():
    assert Base.metadata is not None
    assert callable(SessionLocal)


def test_salud_consulta_postgresql(monkeypatch):
    class Conexion:
        def execute(self, sentencia):
            assert str(sentencia) == "SELECT 1"

    @contextmanager
    def conectar():
        yield Conexion()

    monkeypatch.setattr(main.engine, "connect", conectar)
    respuesta = TestClient(main.app).get("/api/v1/health")
    assert respuesta.status_code == 200
    assert respuesta.json()["database"] == "ok"


def test_salud_informa_fallo_de_postgresql(monkeypatch):
    def fallar():
        raise OperationalError("SELECT 1", {}, Exception("conexion no disponible"))

    monkeypatch.setattr(main.engine, "connect", fallar)
    assert TestClient(main.app).get("/api/v1/health").status_code == 503


def test_frontend_y_api_en_mismo_servidor():
    assert Path(main.FRONTEND_DIR, "index.html").is_file()
    api = TestClient(main.app)
    assert "text/html" in api.get("/").headers["content-type"]
    assert api.get("/js/config.js").status_code == 200
    assert api.get("/pages/empaque/formar-caja.html").status_code == 200
    assert api.get("/openapi.json").status_code == 200
    assert api.get("/api/v1").json()["proyecto"] == "NOVA SOUND"


def test_endpoint_antiguo_delega_en_almacen(monkeypatch):
    monkeypatch.setattr(main.almacen_service, "detalle_caja", lambda id_caja: {"id_caja": id_caja, "unidades": []})
    api = TestClient(main.app)
    assert api.get("/api/cajas/7").json() == {"id_caja": 7, "unidades": []}
    assert api.get("/api/cajas/CX-invalida").status_code == 422
