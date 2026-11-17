"""API de Almacén: contratos HTTP, validaciones Pydantic y OpenAPI."""
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.exc import SQLAlchemyError

from app.modules.almacen import service
from app.modules.almacen.auth import Actor, obtener_actor
from app.modules.almacen.schemas import (
    AutorizacionResumen, CajaCrear, CajaDetalle, CajaResumen, EmbarqueCrear,
    EmbarqueDetalle, EmbarqueResumen, EventoAuditoria, OrdenResumen,
    PanelResumen, ReaperturaAutorizar, ReporteEmpaque, SolicitudReapertura,
    UnidadAgregar, UnidadDetalle, IncidenciaCrear, IncidenciaResumen, Mensaje,
    TrazabilidadUnidad, CierreCaja,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/almacen", tags=["Almacén"])
ERRORES = {
    401: {"description": "No se ha autenticado la operación de escritura"},
    403: {"description": "Usuario sin permisos suficientes"},
    404: {"description": "Recurso no encontrado"},
    409: {"description": "Operación incompatible con el estado o reglas de negocio"},
    503: {"description": "Error al consultar o actualizar PostgreSQL"},
}


def _db(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except SQLAlchemyError as exc:
        log.exception("Error PostgreSQL en módulo Almacén")
        raise HTTPException(status_code=503, detail="No fue posible completar la operación en PostgreSQL") from exc


@router.get("/panel", response_model=PanelResumen,
            summary="Panel de control de Empaque",
            description="Contadores de cajas, unidades listas y embarques. No modifica datos.",
            responses={503: ERRORES[503]})
def panel():
    return _db(service.panel)


@router.get("/ordenes", response_model=list[OrdenResumen],
            summary="Órdenes disponibles para crear cajas",
            description="Lista órdenes, cliente y modelo, indicando la capacidad por caja cuando está configurada.",
            responses={503: ERRORES[503]})
def ordenes():
    return _db(service.listar_ordenes)


@router.get("/unidades-disponibles", response_model=list[UnidadDetalle],
            summary="Buscar unidades liberadas para empacar",
            description="Excluye unidades retenidas, en retrabajo, scrap, ya asignadas o sin liberación vigente de Calidad.",
            responses={404: ERRORES[404], 503: ERRORES[503]})
def unidades_disponibles(
    id_orden: int = Query(gt=0, description="Orden seleccionada al formar una caja"),
    buscar: str | None = Query(default=None, max_length=100, description="Número de serie parcial"),
    limite: int = Query(default=50, ge=1, le=100),
    desplazamiento: int = Query(default=0, ge=0),
):
    return _db(service.disponibles, id_orden, buscar, limite, desplazamiento)


@router.get("/cajas", response_model=list[CajaResumen],
            summary="Consultar historial y cajas de Almacén",
            description="Filtros de cliente, modelo, orden y estado. Incluye unidades por caja; muestra cajas vacías.",
            responses={503: ERRORES[503]})
def cajas(
    id_cliente: int | None = Query(default=None, gt=0),
    id_modelo: int | None = Query(default=None, gt=0),
    id_orden: int | None = Query(default=None, gt=0),
    estado: str | None = Query(default=None, max_length=30),
    id_caja: int | None = Query(default=None, gt=0),
    desde: date | None = Query(default=None, description="Fecha de creación inicial"),
    hasta: date | None = Query(default=None, description="Fecha de creación final inclusiva"),
):
    return _db(service.listar_cajas, id_cliente, id_modelo, id_orden,
               estado, id_caja, desde, hasta)


@router.post("/cajas", response_model=CajaDetalle, status_code=201,
             summary="Formar una nueva caja desde una orden",
             description="Obtiene cliente y modelo de la orden. Valida la capacidad oficial del modelo. Requiere usuario autenticado.",
             responses=ERRORES)
def crear_caja(datos: CajaCrear, actor: Actor = Depends(obtener_actor)):
    return _db(service.crear_caja, datos.id_orden, actor)


@router.get("/cajas/{id_caja}", response_model=CajaDetalle,
            summary="Consultar caja y contenido trazable",
            description="Muestra números de serie, colores y estado más reciente de Calidad.",
            responses={404: ERRORES[404], 503: ERRORES[503]})
def detalle_caja(id_caja: int = Path(gt=0)):
    return _db(service.detalle_caja, id_caja)


@router.post("/cajas/{id_caja}/unidades", response_model=CajaDetalle,
             summary="Escanear o agregar una unidad a caja",
             description=("Operación atómica: únicamente unidad LIBERADA por Calidad, sin caja previa, "
                          "de la misma orden/cliente/modelo, respetando colores y capacidad."),
             responses=ERRORES)
def agregar_unidad(id_caja: int, datos: UnidadAgregar, actor: Actor = Depends(obtener_actor)):
    return _db(service.agregar_unidad, id_caja, datos.numero_serie, actor)


@router.delete("/cajas/{id_caja}/unidades/{id_unidad}", response_model=CajaDetalle,
               summary="Retirar unidad de caja abierta",
               description="Solo aplica si la caja permanece abierta, no embarcada y Calidad sigue liberando la unidad.",
               responses=ERRORES)
def retirar_unidad(id_caja: int, id_unidad: int, actor: Actor = Depends(obtener_actor)):
    return _db(service.retirar_unidad, id_caja, id_unidad, actor)


@router.post("/cajas/{id_caja}/cerrar", response_model=CajaDetalle,
             summary="Confirmar cierre de caja",
             description="Verifica todas las unidades, capacidad, cliente, modelo, orden y reglas de color. Audita el cierre.",
             responses=ERRORES)
def cerrar_caja(id_caja: int, datos: CierreCaja | None = None, actor: Actor = Depends(obtener_actor)):
    return _db(service.cerrar_caja, id_caja, actor, datos.motivo if datos else None)


@router.get("/cajas/{id_caja}/historial", response_model=list[EventoAuditoria],
            summary="Historial de acciones de una caja",
            description="Registra creación, asignación o retiro de unidades, cierre, solicitudes y reapertura.",
            responses={404: ERRORES[404], 503: ERRORES[503]})
def historial_caja(id_caja: int):
    return _db(service.historial_caja, id_caja)


@router.post("/cajas/{id_caja}/solicitudes-reapertura", status_code=201,
             response_model=AutorizacionResumen,
             summary="Solicitar reapertura con motivo",
             description="Crea una solicitud pendiente. La caja permanece cerrada hasta que un supervisor distinto la autoriza.",
             responses=ERRORES)
def solicitar_reapertura(id_caja: int, datos: SolicitudReapertura, actor: Actor = Depends(obtener_actor)):
    return _db(service.solicitar_reapertura, id_caja, datos.motivo, actor)


@router.post("/cajas/{id_caja}/reabrir", response_model=CajaDetalle,
             summary="Autorizar y ejecutar reapertura auditada",
             description="Solo Administrador o Supervisor de Almacén autenticado, distinto del solicitante. No permite cajas con embarque.",
             responses=ERRORES)
def reabrir_caja(id_caja: int, datos: ReaperturaAutorizar, actor: Actor = Depends(obtener_actor)):
    return _db(service.autorizar_reapertura, id_caja, datos.id_autorizacion, actor)


@router.get("/embarques", response_model=list[EmbarqueResumen],
            summary="Consultar embarques",
            description="Incluye cliente, orden, referencia, estado y totales de cajas/unidades.",
            responses={503: ERRORES[503]})
def embarques():
    return _db(service.listar_embarques)


@router.post("/embarques", response_model=EmbarqueDetalle, status_code=201,
             summary="Crear embarque para una orden",
             description="Deriva el cliente desde la orden, registra la referencia y comienza en PREPARACION.",
             responses=ERRORES)
def crear_embarque(datos: EmbarqueCrear, actor: Actor = Depends(obtener_actor)):
    return _db(service.crear_embarque, datos.id_orden, datos.referencia, actor, datos.destino, datos.contenedor)


@router.get("/embarques/{id_embarque}", response_model=EmbarqueDetalle,
            summary="Consultar detalle de embarque",
            description="Muestra todas las cajas y cantidad de unidades por caja.",
            responses={404: ERRORES[404], 503: ERRORES[503]})
def detalle_embarque(id_embarque: int):
    return _db(service.detalle_embarque, id_embarque)


@router.get("/embarques/{id_embarque}/historial", response_model=list[EventoAuditoria],
            summary="Auditoría histórica del embarque",
            description="Muestra creación, incorporación o retiro de cajas, responsables y salida.",
            responses={404: ERRORES[404], 503: ERRORES[503]})
def historial_embarque(id_embarque: int):
    return _db(service.historial_embarque, id_embarque)


@router.post("/embarques/{id_embarque}/cajas/{id_caja}", response_model=EmbarqueDetalle,
             summary="Asignar caja cerrada al embarque",
             description="Controla cliente, orden, liberación de Calidad, caja cerrada y ausencia de embarque previo.",
             responses=ERRORES)
def agregar_caja_embarque(id_embarque: int, id_caja: int, actor: Actor = Depends(obtener_actor)):
    return _db(service.agregar_caja_embarque, id_embarque, id_caja, actor)


@router.post("/embarques/{id_embarque}/salida", response_model=EmbarqueDetalle,
             summary="Registrar salida de embarque",
             description="Revalida todas las cajas y sus unidades y registra fecha de salida, estados y auditoría en transacción.",
             responses=ERRORES)
def registrar_salida(id_embarque: int, actor: Actor = Depends(obtener_actor)):
    return _db(service.registrar_salida, id_embarque, actor)


@router.get("/reportes/empaque", response_model=ReporteEmpaque,
            summary="Reporte de empaque por fechas",
            description="Fechas inclusivas; el reporte distingue cajas cerradas, embarcadas, reaperturas y unidades en cajas. Los datos legados sin fechas no se atribuyen a periodos ficticios.",
            responses={422: {"description": "Rango de fechas inválido"}, 503: ERRORES[503]})
def reporte_empaque(
    desde: date | None = Query(default=None, description="Fecha inicial YYYY-MM-DD"),
    hasta: date | None = Query(default=None, description="Fecha final YYYY-MM-DD inclusiva"),
):
    return _db(service.reporte_empaque, desde, hasta)


@router.get("/trazabilidad/{numero_serie}", response_model=TrazabilidadUnidad,
            summary="Trazabilidad actual e historial de Almacén por serie",
            description=("Consulta lote, orden, cliente, modelo, color, línea, turno, caja, calidad "
                         "y embarque actuales. Incluye los eventos auditados de Empaque y Embarques "
                         "desde que se activó esta versión; no inventa eventos históricos previos."),
            responses={404: ERRORES[404], 503: ERRORES[503]})
def trazabilidad(numero_serie: str):
    return _db(service.trazabilidad, numero_serie)


@router.post("/cajas/{id_caja}/incidencias", response_model=Mensaje, status_code=201,
             summary="Registrar incidencia de empaque",
             description="Registra tipo, motivo, usuario y fecha en bitácora; no borra el historial.",
             responses=ERRORES)
def registrar_incidencia(id_caja: int, datos: IncidenciaCrear, actor: Actor = Depends(obtener_actor)):
    return _db(service.registrar_incidencia, id_caja, datos.tipo, datos.motivo, actor)


@router.get("/reportes/incidencias", response_model=list[IncidenciaResumen],
            summary="Consultar incidencias registradas de Empaque",
            description="Listado auditado con caja, tipo de incidencia, usuario responsable y motivo.",
            responses={503: ERRORES[503]})
def incidencias():
    return _db(service.incidencias)


@router.get("/cajas/{id_caja}/solicitudes-reapertura",
            response_model=list[AutorizacionResumen],
            summary="Consultar solicitudes de reapertura",
            description="Historial de solicitudes pendientes y autorizadas para la caja.",
            responses={404: ERRORES[404], 503: ERRORES[503]})
def solicitudes_reapertura(id_caja: int):
    return _db(service.solicitudes_reapertura, id_caja)


@router.delete("/embarques/{id_embarque}/cajas/{id_caja}", response_model=EmbarqueDetalle,
               summary="Retirar caja antes de la salida",
               description="Desvincula una caja cerrada de un embarque en preparación; registra auditoría.",
               responses=ERRORES)
def quitar_caja_embarque(id_embarque: int, id_caja: int, actor: Actor = Depends(obtener_actor)):
    return _db(service.quitar_caja_embarque, id_embarque, id_caja, actor)
