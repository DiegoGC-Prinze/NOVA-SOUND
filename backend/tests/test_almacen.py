"""Pruebas unitarias y de contrato sin cambiar las tablas reales.
Ejecutar desde backend/: python -m pytest -q tests/test_almacen.py
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.modules.almacen import service
from app.modules.almacen.auth import Actor, obtener_actor


client = TestClient(app)


def test_capacidades_modelos_oficiales(monkeypatch):
    monkeypatch.delenv("ALMACEN_CAPACIDADES_EXTRA", raising=False)
    assert service.capacidad_modelo("NS-MINI") == 12
    assert service.capacidad_modelo("NS-SPORT") == 8
    assert service.capacidad_modelo("NS-PRO") == 6
    assert service.capacidad_modelo("NS-MAX") == 4


def test_modelo_heredado_no_admitido():
    assert service.capacidad_modelo("Modelo SoundPro X") is None
    assert service.capacidad_modelo("MINI") is None


def test_capacidad_no_se_puede_sobrescribir(monkeypatch):
    monkeypatch.setenv("ALMACEN_CAPACIDADES_EXTRA", '{"Modelo SoundPro X": 8}')
    assert service.capacidad_modelo("Modelo SoundPro X") is None


def test_openapi_documenta_los_modulos():
    respuesta = client.get("/openapi.json")
    assert respuesta.status_code == 200
    rutas = respuesta.json()["paths"]
    assert "/api/v1/almacen/cajas" in rutas
    assert "/api/v1/almacen/embarques/{id_embarque}/salida" in rutas
    assert "post" in rutas["/api/v1/almacen/cajas"]
    assert "requestBody" in rutas["/api/v1/almacen/cajas"]["post"]


def test_listado_cajas_vacio(monkeypatch):
    monkeypatch.setattr(service, "listar_cajas", lambda *args: [])
    respuesta = client.get("/api/v1/almacen/cajas")
    assert respuesta.status_code == 200
    assert respuesta.json() == []


def test_panel_responde_con_totales(monkeypatch):
    datos = dict(cajas_en_proceso=1, cajas_cerradas=2, cajas_embarcadas=3,
                 cajas_legacy=0, unidades_pendientes=37, unidades_empacadas=4,
                 embarques_pendientes=1, embarques_enviados=0)
    monkeypatch.setattr(service, "panel", lambda: datos)
    respuesta = client.get("/api/v1/almacen/panel")
    assert respuesta.status_code == 200
    assert respuesta.json() == datos


def test_fecha_reporte_invalida():
    with pytest.raises(HTTPException) as exc:
        service.reporte_empaque(__import__("datetime").date(2026, 11, 15),
                                __import__("datetime").date(2026, 11, 14))
    assert exc.value.status_code == 422


def test_rechaza_caja_vacia(monkeypatch):
    monkeypatch.setattr(service.r, "unidades_caja", lambda cx, id_caja: [])
    with pytest.raises(HTTPException) as exc:
        service._validar_contenido(object(), {
            "id_caja": 99, "capacidad": 12, "id_orden": 1,
            "id_cliente": 1, "id_modelo": 1,
        })
    assert exc.value.status_code == 409


def test_rechaza_unidad_no_liberada(monkeypatch):
    unidades = [dict(id_unidad=1, id_orden=1, id_color=1,
                     estado="EMPACADA", estado_calidad="EN_RETENCION", numero_serie="SN-X")]
    monkeypatch.setattr(service.r, "unidades_caja", lambda cx, id_caja: unidades)
    monkeypatch.setattr(service.r, "obtener_orden", lambda cx, id_orden: {
        "id_orden": 1, "id_cliente": 1, "id_modelo": 1, "id_color": 1, "mezcla_colores": True,
    })
    with pytest.raises(HTTPException) as exc:
        service._validar_contenido(object(), {
            "id_caja": 99, "capacidad": 12, "id_orden": 1,
            "id_cliente": 1, "id_modelo": 1,
        })
    assert exc.value.status_code == 409
    assert "Calidad" in exc.value.detail


def test_rechaza_mezcla_de_colores(monkeypatch):
    unidades = [dict(id_unidad=i, id_orden=1, id_color=i,
                     estado="EMPACADA", estado_calidad="LIBERADA", numero_serie=f"SN-{i}")
                for i in (1, 2)]
    monkeypatch.setattr(service.r, "unidades_caja", lambda cx, id_caja: unidades)
    monkeypatch.setattr(service.r, "obtener_orden", lambda cx, id_orden: {
        "id_orden": 1, "id_cliente": 1, "id_modelo": 1, "id_color": 1, "mezcla_colores": False,
    })
    with pytest.raises(HTTPException) as exc:
        service._validar_contenido(object(), {
            "id_caja": 99, "capacidad": 12, "id_orden": 1,
            "id_cliente": 1, "id_modelo": 1,
        })
    assert exc.value.status_code == 409
    assert "colores" in exc.value.detail


def test_endpoint_crear_caja_con_autenticacion_simulada(monkeypatch):
    # No guarda nada: reemplaza el servicio por un doble de prueba.
    app.dependency_overrides[obtener_actor] = lambda: Actor(1, "Administrador")
    fake = {
        "id_caja": 44, "id_orden": 1, "id_cliente": 1, "cliente": "Demo",
        "id_modelo": 1, "modelo": "NS-MINI", "capacidad": 12,
        "id_embarque": None, "estado": "EN_PROCESO", "fecha_creacion": None,
        "fecha_cierre": None, "cantidad_unidades": 0, "unidades": [],
    }
    monkeypatch.setattr(service, "crear_caja", lambda id_orden, actor: fake)
    try:
        respuesta = client.post("/api/v1/almacen/cajas", json={"id_orden": 1})
        assert respuesta.status_code == 201
        assert respuesta.json()["id_caja"] == 44
    finally:
        app.dependency_overrides.clear()


def test_openapi_muestra_error_de_estado():
    rutas = client.get("/openapi.json").json()["paths"]
    errores = rutas["/api/v1/almacen/cajas/{id_caja}/cerrar"]["post"]["responses"]
    assert "409" in errores


def test_reapertura_exige_supervisor():
    from app.modules.almacen.auth import exigir_supervisor
    with pytest.raises(HTTPException) as exc:
        exigir_supervisor(Actor(2, "Operador"))
    assert exc.value.status_code == 403
    exigir_supervisor(Actor(1, "Administrador"))


def test_rechaza_unidad_de_otra_orden(monkeypatch):
    unidades = [dict(id_unidad=10, id_orden=2, id_color=1,
                     estado="EMPACADA", estado_calidad="LIBERADA", numero_serie="SN-OTRA")]
    monkeypatch.setattr(service.r, "unidades_caja", lambda cx, caja: unidades)
    monkeypatch.setattr(service.r, "obtener_orden", lambda cx, orden: {
        "id_orden": 1, "id_cliente": 1, "id_modelo": 1,
        "id_color": 1, "mezcla_colores": True,
    })
    with pytest.raises(HTTPException) as exc:
        service._validar_contenido(object(), {
            "id_caja": 1, "id_orden": 1, "id_cliente": 1,
            "id_modelo": 1, "capacidad": 8,
        })
    assert exc.value.status_code == 409
    assert "otra orden" in exc.value.detail


def test_rechaza_sobrecapacidad(monkeypatch):
    monkeypatch.setattr(service.r, "unidades_caja", lambda cx, caja: [
        {"id_unidad": 1}, {"id_unidad": 2}
    ])
    with pytest.raises(HTTPException) as exc:
        service._validar_contenido(object(), {
            "id_caja": 1, "capacidad": 1, "id_orden": 1,
            "id_cliente": 1, "id_modelo": 1,
        })
    assert exc.value.status_code == 409


def test_documentacion_cubre_empaque_y_embarques():
    rutas = client.get("/openapi.json").json()["paths"]
    assert len([r for r in rutas if r.startswith("/api/v1/almacen/")]) >= 19
    assert "/api/v1/almacen/reportes/empaque" in rutas
    assert "/api/v1/almacen/cajas/{id_caja}/solicitudes-reapertura" in rutas
