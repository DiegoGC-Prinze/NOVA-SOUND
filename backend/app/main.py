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

@app.get("/api/cajas/{caja_id}")
def obtener_caja_por_id(caja_id: str):
    try:
        with engine.connect() as conexion:
            # Consulta SQL de ejemplo para buscar la caja
            resultado = conexion.execute(
                text("SELECT id, estado, orden, cliente, modelo FROM cajas WHERE id = :caja_id"),
                {"caja_id": caja_id}
            ).fetchone()

            if not resultado:
                raise HTTPException(status_code=404, detail="Caja no encontrada")

            return {
                "id": resultado.id,
                "estado": resultado.estado,
                "orden": resultado.orden,
                "cliente": resultado.cliente,
                "modelo": resultado.modelo,
                # Aquí puedes hacer otra consulta para traer el contenido de las unidades de esta caja
                "contenido": [
                    { "serie": "SN-7998", "modelo": resultado.modelo, "color": "AZUL LIBERADA", "calidad": "OK" }
                ]
            }
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
