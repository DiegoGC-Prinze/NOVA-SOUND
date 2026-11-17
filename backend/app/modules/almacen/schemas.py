"""Contratos JSON documentados en OpenAPI para Empaque y Embarques."""
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class CajaCrear(BaseModel):
    """La orden define el cliente y el modelo; no se aceptan valores arbitrarios."""
    id_orden: int = Field(gt=0, examples=[1], description="Orden de producción existente")


class UnidadAgregar(BaseModel):
    numero_serie: str = Field(min_length=1, max_length=100, examples=["SN-2026-0009"])


class SolicitudReapertura(BaseModel):
    motivo: str = Field(min_length=10, max_length=300, examples=["Corregir captura errónea de una unidad"])


class ReaperturaAutorizar(BaseModel):
    id_autorizacion: int = Field(gt=0, description="Solicitud de reapertura pendiente")


class EmbarqueCrear(BaseModel):
    id_orden: int = Field(gt=0, examples=[1])
    referencia: str = Field(min_length=1, max_length=100, examples=["GUIA-2026-001"])
    destino: str | None = Field(default=None, max_length=200)
    contenedor: str | None = Field(default=None, max_length=100)


class CierreCaja(BaseModel):
    motivo: str | None = Field(default=None, max_length=300)


class CajaResumen(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id_caja: int
    id_orden: int | None
    id_cliente: int
    cliente: str
    id_modelo: int
    modelo: str
    capacidad: int | None
    id_embarque: int | None
    estado: str | None
    fecha_creacion: datetime | None
    fecha_cierre: datetime | None
    cantidad_unidades: int


class UnidadDetalle(BaseModel):
    id_unidad: int
    numero_serie: str | None
    id_color: int
    color: str
    estado: str | None
    estado_calidad: str | None
    id_orden: int
    id_caja: int | None


class CajaDetalle(CajaResumen):
    unidades: list[UnidadDetalle] = Field(default_factory=list)


class OrdenResumen(BaseModel):
    id_orden: int
    id_cliente: int
    cliente: str
    id_modelo: int
    id_color: int
    color: str | None = None
    modelo: str
    cantidad: int
    mezcla_colores: bool
    capacidad_caja: int | None


class EmbarqueResumen(BaseModel):
    id_embarque: int
    id_orden: int
    id_cliente: int
    cliente: str
    referencia: str | None
    destino: str | None = None
    contenedor: str | None = None
    fecha_creacion: datetime | None = None
    estado: str | None
    fecha_salida: datetime | None
    cantidad_cajas: int
    cantidad_unidades: int


class EmbarqueDetalle(EmbarqueResumen):
    cajas: list[CajaResumen] = Field(default_factory=list)


class EventoAuditoria(BaseModel):
    id_bitacora: int
    id_usuario: int
    accion: str | None
    valor_anterior: str | None
    valor_nuevo: str | None
    motivo: str | None
    fecha_hora: datetime | None


class AutorizacionResumen(BaseModel):
    id_autorizacion: int
    id_referencia: int | None
    id_usuario_solicita: int
    id_usuario_autoriza: int | None
    motivo: str | None
    estado: str | None
    fecha_solicitud: datetime | None
    fecha_autorizacion: datetime | None


class PanelResumen(BaseModel):
    cajas_en_proceso: int
    cajas_cerradas: int
    cajas_embarcadas: int
    cajas_legacy: int
    unidades_pendientes: int
    unidades_empacadas: int
    embarques_pendientes: int
    embarques_enviados: int


class ReporteEmpaque(BaseModel):
    desde: datetime | None
    hasta: datetime | None
    cajas_en_proceso: int
    cajas_cerradas: int
    cajas_embarcadas: int
    unidades_en_cajas: int
    reaperturas: int
    incidencias: int


class Mensaje(BaseModel):
    mensaje: str


class IncidenciaCrear(BaseModel):
    tipo: str = Field(min_length=3, max_length=50, examples=["ERROR_ETIQUETA"])
    motivo: str = Field(min_length=10, max_length=500, examples=["Se detectó una etiqueta incorrecta antes de embarcar"])


class IncidenciaResumen(BaseModel):
    id_bitacora: int
    id_caja: int | None
    id_usuario: int
    tipo: str | None
    motivo: str | None
    fecha_hora: datetime | None


class EventoUnidadAlmacen(BaseModel):
    """Evento auditable; no se reconstruye información anterior al despliegue."""
    id_bitacora: int
    id_usuario: int
    accion: str | None
    valor_anterior: str | None
    valor_nuevo: str | None
    motivo: str | None
    fecha_hora: datetime | None
    detalle: dict = Field(default_factory=dict)


class TrazabilidadUnidad(BaseModel):
    id_unidad: int
    numero_serie: str | None
    estado: str | None
    fecha_hora: datetime | None
    id_color: int
    color: str
    id_linea: int
    id_turno: int
    id_orden: int
    id_modelo: int
    modelo: str
    id_cliente: int
    cliente: str
    id_caja: int | None
    id_embarque: int | None
    referencia_embarque: str | None
    fecha_salida: datetime | None
    estado_calidad: str | None
    historial_almacen: list[EventoUnidadAlmacen] = Field(default_factory=list)
