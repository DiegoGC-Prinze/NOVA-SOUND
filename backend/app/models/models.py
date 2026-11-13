from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
# Importa la Base desde tu archivo database.py o db/
from app.db.database import Base

class CajaModel(Base):
    __tablename__ = "cajas"

    id = Column(String, primary_key=True, index=True)
    orden = Column(String, nullable=False)
    cliente = Column(String, nullable=False)
    modelo = Column(String, nullable=False)
    progreso = Column(Integer, default=0)
    estado = Column(String, nullable=False) # Ej: 'CERRADA', 'EN PROCESO'
    fecha_creacion = Column(DateTime, default=datetime.utcnow)

    # Relación con las unidades contenidas en la caja
    unidades = relationship("UnidadModel", back_populates="caja", cascade="all, delete-orphan")


class UnidadModel(Base):
    __tablename__ = "unidades"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    serie = Column(String, unique=True, index=True, nullable=False)
    modelo = Column(String, nullable=False)
    color = Column(String, nullable=False)
    calidad = Column(String, nullable=False) # Ej: 'OK', 'NOK'
    
    # Llave foránea que vincula la unidad con su caja correspondiente
    caja_id = Column(String, ForeignKey("cajas.id"), nullable=True)

    # Relación inversa
    caja = relationship("CajaModel", back_populates="unidades")