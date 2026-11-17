import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Path as ApiPath
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.db.database import engine
from app.modules.almacen.router import router as almacen_router
from app.modules.almacen import service as almacen_service
from app.core.sesiones import router as sesiones_router
from app.modules.gestion import router as gestion_router
from app.modules.calidad.router import router as calidad_router
from app.modules.pruebas import router as pruebas_router
from app.core.inicializacion import crear_sistemas_inicial


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    crear_sistemas_inicial(engine, usuario=os.getenv('SISTEMAS_USUARIO', 'sistemas'),
                           nombre=os.getenv('SISTEMAS_NOMBRE', 'Sistemas'),
                           password=os.getenv('SISTEMAS_PASSWORD', ''))
    yield

app = FastAPI(
    title="NOVA SOUND API",
    description="Sistema de producción, calidad y trazabilidad",
    version="0.1.0",
    lifespan=ciclo_de_vida,
)

app.include_router(almacen_router)
app.include_router(sesiones_router)
app.include_router(gestion_router)
app.include_router(calidad_router)
app.include_router(pruebas_router)

@app.get("/api/v1")
def inicio():
    return {
        "proyecto": "NOVA SOUND",
        "mensaje": "Backend funcionando correctamente",
    }


@app.get("/api/v1/health")
def verificar_servidor():
    try:
        with engine.connect() as conexion:
            conexion.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="PostgreSQL no esta disponible") from exc
    return {
        "status": "ok",
        "servicio": "NOVA SOUND Backend",
        "database": "ok",
    }

@app.get("/api/cajas/{caja_id}", deprecated=True)
def obtener_caja_por_id(caja_id: int = ApiPath(gt=0)):
    try:
        return almacen_service.detalle_caja(caja_id)
    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="Error al consultar la caja en la base de datos",
        )


@app.get("/api/v1/unidades/resumen")
def obtener_resumen_unidades():
    try:
        with engine.connect() as conexion:
            resultado = conexion.execute(
                text("SELECT COUNT(*) FROM unidades")
            )

            total = resultado.scalar_one()

        return {"total": total}

    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="No fue posible consultar la base de datos",
        )


# Registrar el frontend AL FINAL para conservar la prioridad de /api y /docs.
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", str(Path(__file__).resolve().parents[2] / "frontend")))
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
