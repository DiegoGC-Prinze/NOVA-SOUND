from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Defecto(BaseModel):
    categoria: str = Field(min_length=1, max_length=150)
    defecto: str = Field(min_length=1, max_length=100)
    causa: str = Field(default='', max_length=200)


class InspeccionCrear(BaseModel):
    model_config = ConfigDict(extra='forbid')
    disposicion: Literal['LIBERADA','EN_RETENCION','RETRABAJO','SCRAP']
    defectos: list[Defecto] = Field(default_factory=list, max_length=30)
    observaciones: str = Field(default='', max_length=2000)


class DisponerRetencion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    disposicion: Literal['LIBERADA','EN_RETENCION','RETRABAJO','SCRAP']
    observaciones: str = Field(default='', max_length=2000)


class RetrabajoCrear(BaseModel):
    model_config = ConfigDict(extra='forbid')
    descripcion: str = Field(min_length=1, max_length=300)
    resultado: Literal['Corregido','No corregido']
    observaciones: str = Field(default='', max_length=2000)


class InspeccionLegacy(BaseModel):
    model_config = ConfigDict(extra='forbid')
    numero_serie: str = Field(min_length=1, max_length=100)
    id_usuario: int | None = None
    estado: Literal['LIBERADA','EN_RETENCION','RETRABAJO','EN_RETRABAJO','SCRAP']
    id_categoria_defecto: int | None = None
    defecto: str | None = Field(default=None,max_length=100)
    causa: str = Field(default='', max_length=200)
