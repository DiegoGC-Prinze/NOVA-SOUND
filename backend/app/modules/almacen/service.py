"""Reglas de negocio de Empaque y Embarques NOVA SOUND.

Las mutaciones se ejecutan en una transacción y bloquean la caja/embarque.
"""
import json
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import text

from app.db.database import engine
from app.modules.almacen import repository as r
from app.modules.almacen.auth import Actor, exigir_supervisor, exigir_operador

CAPACIDADES_OFICIALES = {"NS-MINI": 12, "NS-SPORT": 8, "NS-PRO": 6, "NS-MAX": 4}


def capacidad_modelo(nombre: str) -> int | None:
    """Acepta exclusivamente los cuatro códigos oficiales del caso NOVA SOUND."""
    return CAPACIDADES_OFICIALES.get(nombre.strip().upper())


def capacidad_configurada(cx, modelo):
    valor = cx.execute(text("SELECT valor FROM configuracion_web WHERE clave='capacidadCaja'")).scalar_one()
    capacidad = valor.get(modelo)
    return capacidad if isinstance(capacidad, int) and capacidad > 0 else None


def _evento_unidad(cx, actor: Actor, unidad: dict, accion: str, *,
                   id_caja: int | None, id_embarque: int | None = None,
                   antes: str | None = None, despues: str | None = None,
                   motivo: str | None = None):
    """Bitácora vinculada al ID inmutable de la unidad para trazabilidad histórica.

    Las referencias quedan en valor_nuevo (JSON) incluso cuando id_caja pasa a NULL.
    """
    datos = {
        "serie": unidad["numero_serie"],
        "id_caja": id_caja,
        "id_embarque": id_embarque,
        "id_orden": unidad["id_orden"],
    }
    if antes is not None:
        datos["estado_anterior"] = antes
    if despues is not None:
        datos["estado_nuevo"] = despues
    r.auditoria(
        cx, actor.id_usuario, unidad["id_unidad"], accion, "unidades",
        antes=json.dumps({"estado": antes}, ensure_ascii=False) if antes is not None else None,
        despues=json.dumps(datos, ensure_ascii=False), motivo=motivo,
    )


def _eventos_caja(cx, actor: Actor, id_caja: int, accion: str, *,
                   id_embarque: int | None = None,
                   antes: str | None = None, despues: str | None = None):
    for unidad in r.unidades_caja(cx, id_caja):
        _evento_unidad(cx, actor, unidad, accion,
                       id_caja=id_caja, id_embarque=id_embarque,
                       antes=antes, despues=despues)


def _error(codigo: int, detalle: str):
    raise HTTPException(status_code=codigo, detail=detalle)


def _caja(cx, id_caja, bloqueo=False):
    if bloqueo:
        r.bloquear_caja(cx, id_caja)
    caja = r.obtener_caja(cx, id_caja)
    if caja is None:
        _error(404, "Caja no encontrada")
    return caja


def _embarque(cx, id_embarque, bloqueo=False):
    if bloqueo:
        r.bloquear_embarque(cx, id_embarque)
    embarque = r.obtener_embarque(cx, id_embarque)
    if embarque is None:
        _error(404, "Embarque no encontrado")
    return embarque


def _validar_contenido(cx, caja):
    unidades = r.unidades_caja(cx, caja["id_caja"])
    if not unidades:
        _error(409, "No se puede cerrar o embarcar una caja vacía")
    if caja["capacidad"] is None or len(unidades) > caja["capacidad"]:
        _error(409, "Capacidad de caja inválida o excedida")
    if caja["id_orden"] is None:
        _error(409, "Caja heredada sin orden vinculada; requiere regularización")
    orden = r.obtener_orden(cx, caja["id_orden"])
    if orden is None or orden["id_cliente"] != caja["id_cliente"] or orden["id_modelo"] != caja["id_modelo"]:
        _error(409, "Orden, cliente o modelo incompatibles con la caja")
    if not orden["mezcla_colores"]:
        if len({u["id_color"] for u in unidades}) > 1:
            _error(409, "El cliente no permite mezclar colores")
        if any(u["id_color"] != orden["id_color"] for u in unidades):
            _error(409, "El color de la unidad no coincide con la orden")
    for unidad in unidades:
        if unidad["id_orden"] != caja["id_orden"]:
            _error(409, f"Unidad {unidad['numero_serie']} pertenece a otra orden")
        if unidad["estado"] != "EMPACADA" or unidad["estado_calidad"] != "LIBERADA":
            _error(409, f"Unidad {unidad['numero_serie']} no está liberada por Calidad")
        if not unidad["numero_serie"]:
            _error(409, "Existe una unidad sin número de serie")
    return unidades


def listar_ordenes():
    with engine.connect() as cx:
        ordenes = r.listar_ordenes(cx)
        return [{**orden, "capacidad_caja": capacidad_configurada(cx, orden["modelo"])} for orden in ordenes]


def listar_cajas(id_cliente=None, id_modelo=None, id_orden=None, estado=None,
                 id_caja=None, desde=None, hasta=None):
    if desde and hasta and desde > hasta:
        _error(422, "La fecha 'desde' no puede ser posterior a 'hasta'")
    desde_dt = datetime.combine(desde, time.min) if desde else None
    hasta_dt = datetime.combine(hasta + timedelta(days=1), time.min) if hasta else None
    with engine.connect() as cx:
        return r.listar_cajas(cx, id_cliente, id_modelo, id_orden,
                             estado, id_caja, desde_dt, hasta_dt)


def detalle_caja(id_caja):
    with engine.connect() as cx:
        caja = _caja(cx, id_caja)
        return {**caja, "unidades": r.unidades_caja(cx, id_caja)}


def disponibles(id_orden, buscar=None, limite=50, desplazamiento=0):
    with engine.connect() as cx:
        if r.obtener_orden(cx, id_orden) is None:
            _error(404, "Orden no encontrada")
        return r.disponibles(cx, id_orden, buscar, limite, desplazamiento)


def crear_caja(id_orden: int, actor: Actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        orden = r.obtener_orden(cx, id_orden)
        if orden is None:
            _error(404, "Orden de producción no encontrada")
        capacidad = capacidad_configurada(cx, orden["modelo"])
        if capacidad is None:
            _error(422, f"No está definida la capacidad del modelo '{orden['modelo']}'")
        id_caja = r.crear_caja(cx, orden, capacidad)
        r.auditoria(cx, actor.id_usuario, id_caja, "CREAR_CAJA", "cajas",
                    despues=f"Orden={id_orden}, Capacidad={capacidad}")
        return {**_caja(cx, id_caja), "unidades": []}


def agregar_unidad(id_caja, numero_serie, actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["estado"] != "EN_PROCESO" or caja["id_embarque"] is not None:
            _error(409, "Solo se pueden modificar cajas abiertas y no asignadas a embarque")
        unidad = r.obtener_unidad(cx, numero_serie.strip(), bloquear=True)
        if unidad is None:
            _error(404, "Número de serie no encontrado")
        if unidad["id_caja"] is not None:
            _error(409, "La unidad ya pertenece a una caja")
        if unidad["estado"] != "LIBERADA" or unidad["estado_calidad"] != "LIBERADA":
            _error(409, "Calidad no ha liberado esta unidad")
        if caja["id_orden"] != unidad["id_orden"] or caja["id_cliente"] != unidad["id_cliente"] or caja["id_modelo"] != unidad["id_modelo"]:
            _error(409, "La unidad no corresponde a la orden, cliente y modelo de la caja")
        if caja["capacidad"] is None or caja["cantidad_unidades"] >= caja["capacidad"]:
            _error(409, "La caja alcanzó su capacidad máxima")
        orden = r.obtener_orden(cx, caja["id_orden"])
        colores = r.colores_caja(cx, id_caja)
        if not orden["mezcla_colores"]:
            if colores and unidad["id_color"] not in colores:
                _error(409, "El cliente no permite mezclar colores en la misma caja")
            if unidad["id_color"] != orden["id_color"]:
                _error(409, "El color de la unidad no coincide con la orden")
        if not r.asignar_unidad(cx, unidad["id_unidad"], id_caja):
            _error(409, "La unidad fue asignada o cambió de estado")
        r.auditoria(cx, actor.id_usuario, id_caja, "AGREGAR_UNIDAD", "cajas",
                    despues=numero_serie)
        _evento_unidad(cx, actor, unidad, "AGREGAR_UNIDAD",
                       id_caja=id_caja, antes="LIBERADA", despues="EMPACADA")
        return {**_caja(cx, id_caja), "unidades": r.unidades_caja(cx, id_caja)}


def retirar_unidad(id_caja, id_unidad, actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["estado"] != "EN_PROCESO" or caja["id_embarque"] is not None:
            _error(409, "La caja no está abierta")
        unidades = r.unidades_caja(cx, id_caja)
        unidad = next((u for u in unidades if u["id_unidad"] == id_unidad), None)
        if unidad is None:
            _error(404, "La unidad no pertenece a esta caja")
        # No permitir que una unidad retenida vuelva a figurar como LIBERADA.
        if unidad["estado_calidad"] != "LIBERADA":
            _error(409, "Calidad cambió el estado; se requiere conciliación")
        if not r.retirar_unidad(cx, id_unidad, id_caja):
            _error(409, "La unidad no se pudo retirar")
        r.auditoria(cx, actor.id_usuario, id_caja, "RETIRAR_UNIDAD", "cajas",
                    antes=unidad["numero_serie"])
        _evento_unidad(cx, actor, unidad, "RETIRAR_UNIDAD",
                       id_caja=id_caja, antes="EMPACADA", despues="LIBERADA")
        return {**_caja(cx, id_caja), "unidades": r.unidades_caja(cx, id_caja)}


def cerrar_caja(id_caja, actor, motivo=None):
    exigir_operador(actor)
    with engine.begin() as cx:
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["estado"] != "EN_PROCESO" or caja["id_embarque"] is not None:
            _error(409, "La caja no está abierta o ya está asignada")
        unidades = _validar_contenido(cx, caja)
        motivo = (motivo or '').strip()
        if len(unidades) < caja['capacidad'] and len(motivo) < 10:
            _error(422, 'Escribe un motivo de al menos 10 caracteres para cerrar una caja incompleta.')
        r.estado_caja(cx, id_caja, "CERRADA", cerrar=True)
        r.auditoria(cx, actor.id_usuario, id_caja, "CERRAR_CAJA", "cajas",
                    antes="EN_PROCESO", despues="CERRADA", motivo=motivo or None)
        _eventos_caja(cx, actor, id_caja, "CERRAR_CAJA",
                      antes="EN_PROCESO", despues="CERRADA")
        return {**_caja(cx, id_caja), "unidades": r.unidades_caja(cx, id_caja)}


def solicitar_reapertura(id_caja, motivo, actor):
    with engine.begin() as cx:
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["estado"] != "CERRADA" or caja["id_embarque"] is not None:
            _error(409, "Solo cajas cerradas sin embarque pueden solicitar reapertura")
        id_autorizacion = r.solicitar_reapertura(cx, id_caja, actor.id_usuario, motivo)
        r.auditoria(cx, actor.id_usuario, id_caja, "SOLICITAR_REAPERTURA", "cajas",
                    despues=f"Solicitud {id_autorizacion}", motivo=motivo,
                    id_autorizacion=id_autorizacion)
        return r.obtener_autorizacion(cx, id_autorizacion)


def autorizar_reapertura(id_caja, id_autorizacion, actor):
    exigir_supervisor(actor)
    with engine.begin() as cx:
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["estado"] != "CERRADA" or caja["id_embarque"] is not None:
            _error(409, "Caja no elegible para reapertura")
        autorizacion = r.obtener_autorizacion(cx, id_autorizacion)
        if not autorizacion or autorizacion["id_referencia"] != id_caja or autorizacion["tipo_referencia"] != "CAJA":
            _error(404, "Solicitud de reapertura no encontrada para esta caja")
        if autorizacion["estado"] != "PENDIENTE":
            _error(409, "La solicitud ya fue procesada")
        if autorizacion["id_usuario_solicita"] == actor.id_usuario:
            _error(403, "La autorización requiere un usuario supervisor distinto")
        r.aprobar_autorizacion(cx, id_autorizacion, actor.id_usuario)
        r.estado_caja(cx, id_caja, "EN_PROCESO", cerrar=False)
        r.auditoria(cx, actor.id_usuario, id_caja, "REABRIR_CAJA", "cajas",
                    antes="CERRADA", despues="EN_PROCESO", motivo=autorizacion["motivo"],
                    id_autorizacion=id_autorizacion)
        _eventos_caja(cx, actor, id_caja, "REABRIR_CAJA",
                      antes="CERRADA", despues="EN_PROCESO")
        return {**_caja(cx, id_caja), "unidades": r.unidades_caja(cx, id_caja)}


def historial_caja(id_caja):
    with engine.connect() as cx:
        _caja(cx, id_caja)
        return r.historial_caja(cx, id_caja)


def listar_embarques():
    with engine.connect() as cx:
        return r.listar_embarques(cx)


def detalle_embarque(id_embarque):
    with engine.connect() as cx:
        embarque = _embarque(cx, id_embarque)
        return {**embarque, "cajas": r.cajas_embarque(cx, id_embarque)}


def historial_embarque(id_embarque):
    with engine.connect() as cx:
        _embarque(cx, id_embarque)
        return r.historial_embarque(cx, id_embarque)


def crear_embarque(id_orden, referencia, actor, destino=None, contenedor=None):
    exigir_operador(actor)
    with engine.begin() as cx:
        orden = r.obtener_orden(cx, id_orden)
        if orden is None:
            _error(404, "Orden no encontrada")
        if not referencia.strip():
            _error(422, 'Escribe la referencia del embarque.')
        id_embarque = r.crear_embarque(cx, orden, referencia.strip(), (destino or '').strip() or None, (contenedor or '').strip() or None)
        r.auditoria(cx, actor.id_usuario, id_embarque, "CREAR_EMBARQUE", "embarques",
                    despues=f"Orden={id_orden}, Referencia={referencia}")
        return {**_embarque(cx, id_embarque), "cajas": []}


def agregar_caja_embarque(id_embarque, id_caja, actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        embarque = _embarque(cx, id_embarque, bloqueo=True)
        if embarque["estado"] != "PREPARACION":
            _error(409, "El embarque ya salió")
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["estado"] != "CERRADA" or caja["id_embarque"] is not None:
            _error(409, "El embarque solo acepta cajas cerradas y sin asignar")
        if caja["id_cliente"] != embarque["id_cliente"] or caja["id_orden"] != embarque["id_orden"]:
            _error(409, "Caja con cliente u orden incompatibles con el embarque")
        _validar_contenido(cx, caja)
        if not r.asignar_caja_embarque(cx, id_caja, id_embarque):
            _error(409, "La caja cambió de estado")
        r.auditoria(cx, actor.id_usuario, id_caja, "ASIGNAR_EMBARQUE", "cajas",
                    despues=f"Embarque={id_embarque}")
        r.auditoria(cx, actor.id_usuario, id_embarque, "ASIGNAR_CAJA", "embarques",
                    despues=f"Caja={id_caja}")
        _eventos_caja(cx, actor, id_caja, "ASIGNAR_EMBARQUE", id_embarque=id_embarque)
        return {**_embarque(cx, id_embarque), "cajas": r.cajas_embarque(cx, id_embarque)}


def registrar_salida(id_embarque, actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        embarque = _embarque(cx, id_embarque, bloqueo=True)
        if embarque["estado"] != "PREPARACION":
            _error(409, "El embarque no está en preparación")
        cajas = r.cajas_embarque(cx, id_embarque)
        if not cajas:
            _error(409, "No se puede enviar un embarque sin cajas")
        for caja in cajas:
            r.bloquear_caja(cx, caja["id_caja"])
            caja = _caja(cx, caja["id_caja"])
            if caja["estado"] != "CERRADA" or caja["id_cliente"] != embarque["id_cliente"] or caja["id_orden"] != embarque["id_orden"]:
                _error(409, f"Caja {caja['id_caja']} incompatible o no cerrada")
            _validar_contenido(cx, caja)
        r.marcar_salida(cx, id_embarque)
        r.auditoria(cx, actor.id_usuario, id_embarque, "REGISTRAR_SALIDA", "embarques",
                    antes="PREPARACION", despues="ENVIADO")
        for caja in cajas:
            _eventos_caja(cx, actor, caja["id_caja"], "REGISTRAR_SALIDA",
                          id_embarque=id_embarque, antes="EMPACADA", despues="EMBARCADA")
        return {**_embarque(cx, id_embarque), "cajas": r.cajas_embarque(cx, id_embarque)}


def panel():
    with engine.connect() as cx:
        return r.panel(cx)


def reporte_empaque(desde: date | None, hasta: date | None):
    if desde and hasta and desde > hasta:
        _error(422, "La fecha 'desde' no puede ser posterior a 'hasta'")
    desde_dt = datetime.combine(desde, time.min) if desde else None
    hasta_dt = datetime.combine(hasta + timedelta(days=1), time.min) if hasta else None
    with engine.connect() as cx:
        return {"desde": desde_dt, "hasta": hasta_dt, **r.reporte(cx, desde_dt, hasta_dt)}


def trazabilidad(numero_serie):
    with engine.connect() as cx:
        unidad = r.trazabilidad(cx, numero_serie)
        if unidad is None:
            _error(404, "Número de serie no encontrado")
        eventos = r.historial_unidad(cx, unidad["id_unidad"])
        unidad["historial_almacen"] = [
            {**evento, "detalle": _leer_evento(evento["valor_nuevo"])}
            for evento in eventos
        ]
        return unidad


def _leer_evento(texto: str | None) -> dict:
    if not texto:
        return {}
    try:
        dato = json.loads(texto)
        return dato if isinstance(dato, dict) else {"valor": str(dato)}
    except (TypeError, json.JSONDecodeError):
        return {"valor": texto}


def registrar_incidencia(id_caja, tipo, motivo, actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        _caja(cx, id_caja, bloqueo=True)
        r.auditoria(cx, actor.id_usuario, id_caja, "INCIDENCIA", "cajas",
                    despues=tipo.strip().upper(), motivo=motivo.strip())
    return {"mensaje": "Incidencia registrada y auditada"}

def incidencias():
    with engine.connect() as cx:
        return r.incidencias(cx)


def solicitudes_reapertura(id_caja):
    with engine.connect() as cx:
        _caja(cx, id_caja)
        return r.solicitudes_reapertura(cx, id_caja)

def quitar_caja_embarque(id_embarque, id_caja, actor):
    exigir_operador(actor)
    with engine.begin() as cx:
        embarque = _embarque(cx, id_embarque, bloqueo=True)
        if embarque["estado"] != "PREPARACION":
            _error(409, "No se pueden modificar embarques enviados")
        caja = _caja(cx, id_caja, bloqueo=True)
        if caja["id_embarque"] != id_embarque or caja["estado"] != "CERRADA":
            _error(409, "La caja no está cerrada y asignada a este embarque")
        if not r.quitar_caja_embarque(cx, id_caja, id_embarque):
            _error(409, "La asignación cambió")
        r.auditoria(cx, actor.id_usuario, id_caja, "QUITAR_EMBARQUE", "cajas",
                    antes=f"Embarque={id_embarque}", despues="Sin asignación")
        r.auditoria(cx, actor.id_usuario, id_embarque, "QUITAR_CAJA", "embarques",
                    antes=f"Caja={id_caja}")
        _eventos_caja(cx, actor, id_caja, "QUITAR_EMBARQUE", id_embarque=id_embarque)
        return {**_embarque(cx, id_embarque), "cajas": r.cajas_embarque(cx, id_embarque)}
