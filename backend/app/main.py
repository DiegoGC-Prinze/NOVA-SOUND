from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine

app = FastAPI(
    title="NOVA SOUND API",
    description="Sistema de producción, calidad y trazabilidad",
    version="0.1.0",
)


@app.get("/")
def inicio():
    return {
        "proyecto": "NOVA SOUND",
        "mensaje": "Backend funcionando correctamente",
    }


@app.get("/api/v1/health")
def verificar_servidor():
    return {
        "status": "ok",
        "servicio": "NOVA SOUND Backend",
    }


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
