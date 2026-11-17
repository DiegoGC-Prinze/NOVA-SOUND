"""Acceso a PostgreSQL. Recibe una Connection de la transacción actual."""
from sqlalchemy import text


def uno(cx, sql, **params):
    fila = cx.execute(text(sql), params).mappings().first()
    return dict(fila) if fila else None


def todos(cx, sql, **params):
    return [dict(f) for f in cx.execute(text(sql), params).mappings().all()]


def ejecutar(cx, sql, **params):
    return cx.execute(text(sql), params)


def obtener_orden(cx, id_orden):
    return uno(cx, """
        SELECT o.id_orden, o.id_cliente, cl.nombre AS cliente,
               cl.mezcla_colores, o.id_modelo, o.id_color, co.nombre AS color, m.nombre AS modelo, o.cantidad
        FROM ordenes o JOIN clientes cl ON cl.id_cliente = o.id_cliente
        JOIN modelos m ON m.id_modelo = o.id_modelo
        JOIN colores co ON co.id_color=o.id_color
        WHERE o.id_orden = :id
    """, id=id_orden)


def listar_ordenes(cx):
    return todos(cx, """
        SELECT o.id_orden, o.id_cliente, cl.nombre AS cliente,
               cl.mezcla_colores, o.id_modelo, o.id_color, co.nombre AS color, m.nombre AS modelo, o.cantidad
        FROM ordenes o JOIN clientes cl ON cl.id_cliente = o.id_cliente
        JOIN modelos m ON m.id_modelo = o.id_modelo
        JOIN colores co ON co.id_color=o.id_color
        ORDER BY o.id_orden DESC
    """)


_CAJA_SELECT = """
    SELECT c.id_caja, c.id_orden, c.id_cliente, cl.nombre AS cliente,
           c.id_modelo, m.nombre AS modelo, c.capacidad, c.id_embarque,
           c.estado, c.fecha_creacion, c.fecha_cierre,
           (SELECT COUNT(*) FROM unidades u WHERE u.id_caja=c.id_caja) AS cantidad_unidades
    FROM cajas c
    JOIN clientes cl ON cl.id_cliente = c.id_cliente
    JOIN modelos m ON m.id_modelo = c.id_modelo
"""


def listar_cajas(cx, id_cliente=None, id_modelo=None, id_orden=None,
                 estado=None, id_caja=None, desde=None, hasta=None):
    # Predicados opcionales construidos con enlaces parametrizados: evita problemas
    # de inferencia de tipo con `:param IS NULL` en PostgreSQL + psycopg.
    filtros = []
    params = {}
    for columna, valor, clave in (
        ("c.id_cliente", id_cliente, "cliente"),
        ("c.id_modelo", id_modelo, "modelo"),
        ("c.id_orden", id_orden, "orden"),
        ("c.estado", estado, "estado"),
        ("c.id_caja", id_caja, "caja"),
    ):
        if valor is not None:
            filtros.append(f"{columna}=:{clave}")
            params[clave] = valor
    if desde is not None:
        filtros.append("c.fecha_creacion >= :desde")
        params["desde"] = desde
    if hasta is not None:
        filtros.append("c.fecha_creacion < :hasta")
        params["hasta"] = hasta
    where = " WHERE " + " AND ".join(filtros) if filtros else ""
    return todos(cx, _CAJA_SELECT + where + " ORDER BY c.id_caja DESC", **params)


def obtener_caja(cx, id_caja):
    return uno(cx, _CAJA_SELECT + " WHERE c.id_caja=:id", id=id_caja)


def bloquear_caja(cx, id_caja):
    return ejecutar(cx, "SELECT id_caja FROM cajas WHERE id_caja=:id FOR UPDATE", id=id_caja).first()


def unidades_caja(cx, id_caja):
    return todos(cx, """
        SELECT u.id_unidad, u.numero_serie, u.id_color,
               co.nombre AS color, u.estado, u.id_caja, l.id_orden,
               (SELECT q.estado FROM calidad q
                WHERE q.id_unidad=u.id_unidad
                ORDER BY q.fecha DESC NULLS LAST, q.id_calidad DESC LIMIT 1) AS estado_calidad
        FROM unidades u
        JOIN colores co ON co.id_color=u.id_color
        JOIN lote l ON l.id_lote=u.id_lote
        WHERE u.id_caja=:id ORDER BY u.id_unidad
    """, id=id_caja)


def obtener_unidad(cx, numero_serie, bloquear=False):
    sql = """
        SELECT u.id_unidad, u.numero_serie, u.id_color, co.nombre AS color,
               u.id_caja, u.estado, l.id_orden,
               o.id_cliente, o.id_modelo,
               (SELECT q.estado FROM calidad q WHERE q.id_unidad=u.id_unidad
                ORDER BY q.fecha DESC NULLS LAST, q.id_calidad DESC LIMIT 1) AS estado_calidad
        FROM unidades u
        JOIN lote l ON l.id_lote=u.id_lote
        JOIN ordenes o ON o.id_orden=l.id_orden
        JOIN colores co ON co.id_color=u.id_color
        WHERE u.numero_serie=:numero_serie
    """ + (" FOR UPDATE OF u" if bloquear else "")
    return uno(cx, sql, numero_serie=numero_serie)


def disponibles(cx, id_orden, buscar=None, limite=50, desplazamiento=0):
    return todos(cx, """
        SELECT u.id_unidad, u.numero_serie, u.id_color, col.nombre AS color,
               u.estado, u.id_caja, l.id_orden, ult.estado AS estado_calidad
        FROM unidades u JOIN lote l ON l.id_lote=u.id_lote
        JOIN colores col ON col.id_color=u.id_color
        LEFT JOIN LATERAL (
            SELECT q.estado FROM calidad q WHERE q.id_unidad=u.id_unidad
            ORDER BY q.fecha DESC NULLS LAST, q.id_calidad DESC LIMIT 1
        ) ult ON TRUE
        WHERE l.id_orden=:id_orden AND u.id_caja IS NULL
          AND u.estado='LIBERADA' AND ult.estado='LIBERADA'
          AND (CAST(:buscar AS text) IS NULL OR u.numero_serie ILIKE CAST(:buscar AS text))
        ORDER BY u.id_unidad LIMIT :limite OFFSET :desplazamiento
    """, id_orden=id_orden, buscar=f"%{buscar}%" if buscar else None, limite=limite, desplazamiento=desplazamiento)


def colores_caja(cx, id_caja):
    return {r["id_color"] for r in todos(cx,
        "SELECT DISTINCT id_color FROM unidades WHERE id_caja=:id", id=id_caja)}


def crear_caja(cx, orden, capacidad):
    return ejecutar(cx, """
        INSERT INTO cajas(id_orden, id_cliente, id_modelo, capacidad, estado)
        VALUES (:orden, :cliente, :modelo, :capacidad, 'EN_PROCESO')
        RETURNING id_caja
    """, orden=orden["id_orden"], cliente=orden["id_cliente"],
        modelo=orden["id_modelo"], capacidad=capacidad).scalar_one()


def asignar_unidad(cx, id_unidad, id_caja):
    return ejecutar(cx, """
        UPDATE unidades SET id_caja=:caja, estado='EMPACADA'
        WHERE id_unidad=:unidad AND id_caja IS NULL AND estado='LIBERADA'
    """, caja=id_caja, unidad=id_unidad).rowcount


def retirar_unidad(cx, id_unidad, id_caja):
    return ejecutar(cx, """
        UPDATE unidades SET id_caja=NULL, estado='LIBERADA'
        WHERE id_unidad=:unidad AND id_caja=:caja AND estado='EMPACADA'
    """, caja=id_caja, unidad=id_unidad).rowcount


def estado_caja(cx, id_caja, estado, cerrar=False):
    ejecutar(cx, """
        UPDATE cajas SET estado=:estado,
        fecha_cierre=CASE WHEN :cerrar THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id_caja=:id
    """, estado=estado, cerrar=cerrar, id=id_caja)


def auditoria(cx, id_usuario, id_referencia, accion, tabla, antes=None, despues=None, motivo=None, id_autorizacion=None):
    ejecutar(cx, """
        INSERT INTO bitacora_general(
            id_usuario, id_registro_afectado, id_autorizacion,
            accion, tabla_afectada, valor_anterior, valor_nuevo, motivo)
        VALUES (:usuario,:referencia,:autorizacion,:accion,:tabla,:antes,:despues,:motivo)
    """, usuario=id_usuario, referencia=id_referencia, autorizacion=id_autorizacion,
       accion=accion, tabla=tabla, antes=str(antes)[:500] if antes is not None else None,
       despues=str(despues)[:500] if despues is not None else None, motivo=motivo)


def historial_caja(cx, id_caja):
    return todos(cx, """
        SELECT id_bitacora, id_usuario, accion, valor_anterior,
               valor_nuevo, motivo, fecha_hora
        FROM bitacora_general
        WHERE tabla_afectada='cajas' AND id_registro_afectado=:id
        ORDER BY fecha_hora DESC, id_bitacora DESC
    """, id=id_caja)


def solicitar_reapertura(cx, id_caja, actor, motivo):
    return ejecutar(cx, """
        INSERT INTO autorizacion(
            id_usuario_solicita, id_referencia, tipo_referencia,
            motivo, estado)
        VALUES (:actor,:id,'CAJA',:motivo,'PENDIENTE') RETURNING id_autorizacion
    """, actor=actor, id=id_caja, motivo=motivo).scalar_one()


def obtener_autorizacion(cx, id_autorizacion):
    return uno(cx, """
        SELECT id_autorizacion, id_usuario_solicita, id_usuario_autoriza,
            id_referencia, tipo_referencia, motivo, estado,
            fecha_solicitud, fecha_autorizacion
        FROM autorizacion WHERE id_autorizacion=:id FOR UPDATE
    """, id=id_autorizacion)


def aprobar_autorizacion(cx, id_autorizacion, supervisor):
    ejecutar(cx, """
        UPDATE autorizacion SET estado='APROBADA',
        id_usuario_autoriza=:supervisor, fecha_autorizacion=CURRENT_TIMESTAMP
        WHERE id_autorizacion=:id AND estado='PENDIENTE'
    """, id=id_autorizacion, supervisor=supervisor)


_EMBARQUE_SELECT = """
    SELECT e.id_embarque,e.id_orden,e.id_cliente,cl.nombre AS cliente,
           e.referencia,e.destino,e.contenedor,e.fecha_creacion,e.estado,e.fecha_salida,
           (SELECT COUNT(*) FROM cajas c WHERE c.id_embarque=e.id_embarque) AS cantidad_cajas,
           (SELECT COUNT(*) FROM unidades u JOIN cajas c ON c.id_caja=u.id_caja
            WHERE c.id_embarque=e.id_embarque) AS cantidad_unidades
    FROM embarques e JOIN clientes cl ON cl.id_cliente=e.id_cliente
"""


def listar_embarques(cx):
    return todos(cx, _EMBARQUE_SELECT + " ORDER BY e.id_embarque DESC")


def obtener_embarque(cx, id_embarque):
    return uno(cx, _EMBARQUE_SELECT + " WHERE e.id_embarque=:id", id=id_embarque)


def bloquear_embarque(cx, id_embarque):
    return ejecutar(cx,
        "SELECT id_embarque FROM embarques WHERE id_embarque=:id FOR UPDATE",
        id=id_embarque).first()


def crear_embarque(cx, orden, referencia, destino=None, contenedor=None):
    return ejecutar(cx, """
        INSERT INTO embarques(id_cliente,id_orden,referencia,destino,contenedor,estado)
        VALUES (:cliente,:orden,:referencia,:destino,:contenedor,'PREPARACION') RETURNING id_embarque
    """, cliente=orden["id_cliente"], orden=orden["id_orden"],
       referencia=referencia, destino=destino, contenedor=contenedor).scalar_one()


def asignar_caja_embarque(cx, id_caja, id_embarque):
    return ejecutar(cx, """
        UPDATE cajas SET id_embarque=:embarque
        WHERE id_caja=:caja AND id_embarque IS NULL AND estado='CERRADA'
    """, embarque=id_embarque, caja=id_caja).rowcount


def cajas_embarque(cx, id_embarque):
    return todos(cx, _CAJA_SELECT + " WHERE c.id_embarque=:id ORDER BY c.id_caja", id=id_embarque)


def marcar_salida(cx, id_embarque):
    ejecutar(cx, """
        UPDATE embarques SET estado='ENVIADO', fecha_salida=CURRENT_TIMESTAMP
        WHERE id_embarque=:id
    """, id=id_embarque)
    ejecutar(cx, """
        UPDATE cajas SET estado='EMBARCADA' WHERE id_embarque=:id
    """, id=id_embarque)
    ejecutar(cx, """
        UPDATE unidades SET estado='EMBARCADA'
        WHERE id_caja IN (SELECT id_caja FROM cajas WHERE id_embarque=:id)
    """, id=id_embarque)


def panel(cx):
    return uno(cx, """
        SELECT
          (SELECT COUNT(*) FROM cajas WHERE estado='EN_PROCESO') AS cajas_en_proceso,
          (SELECT COUNT(*) FROM cajas WHERE estado='CERRADA') AS cajas_cerradas,
          (SELECT COUNT(*) FROM cajas WHERE estado='EMBARCADA') AS cajas_embarcadas,
          (SELECT COUNT(*) FROM cajas WHERE estado NOT IN ('EN_PROCESO','CERRADA','EMBARCADA') OR estado IS NULL) AS cajas_legacy,
          (SELECT COUNT(*) FROM unidades u WHERE u.id_caja IS NULL AND u.estado='LIBERADA'
           AND (SELECT q.estado FROM calidad q WHERE q.id_unidad=u.id_unidad
                ORDER BY q.fecha DESC NULLS LAST, q.id_calidad DESC LIMIT 1)='LIBERADA') AS unidades_pendientes,
          (SELECT COUNT(*) FROM unidades WHERE estado='EMPACADA') AS unidades_empacadas,
          (SELECT COUNT(*) FROM embarques WHERE estado='PREPARACION') AS embarques_pendientes,
          (SELECT COUNT(*) FROM embarques WHERE estado='ENVIADO') AS embarques_enviados
    """)


def reporte(cx, desde, hasta):
    return uno(cx, """
        SELECT
          (SELECT COUNT(*) FROM cajas WHERE estado='EN_PROCESO'
             AND (CAST(:desde AS timestamp) IS NULL OR fecha_creacion >= CAST(:desde AS timestamp))
             AND (CAST(:hasta AS timestamp) IS NULL OR fecha_creacion < CAST(:hasta AS timestamp))) AS cajas_en_proceso,
          (SELECT COUNT(*) FROM cajas WHERE estado='CERRADA'
             AND (CAST(:desde AS timestamp) IS NULL OR fecha_cierre >= CAST(:desde AS timestamp))
             AND (CAST(:hasta AS timestamp) IS NULL OR fecha_cierre < CAST(:hasta AS timestamp))) AS cajas_cerradas,
          (SELECT COUNT(*) FROM cajas c JOIN embarques e ON e.id_embarque=c.id_embarque
             WHERE c.estado='EMBARCADA'
             AND (CAST(:desde AS timestamp) IS NULL OR e.fecha_salida >= CAST(:desde AS timestamp))
             AND (CAST(:hasta AS timestamp) IS NULL OR e.fecha_salida < CAST(:hasta AS timestamp))) AS cajas_embarcadas,
          (SELECT COUNT(*) FROM unidades u JOIN cajas c ON c.id_caja=u.id_caja
             WHERE (CAST(:desde AS timestamp) IS NULL OR c.fecha_creacion >= CAST(:desde AS timestamp))
             AND (CAST(:hasta AS timestamp) IS NULL OR c.fecha_creacion < CAST(:hasta AS timestamp))) AS unidades_en_cajas,
          (SELECT COUNT(*) FROM bitacora_general WHERE accion='REABRIR_CAJA'
             AND (CAST(:desde AS timestamp) IS NULL OR fecha_hora >= CAST(:desde AS timestamp))
             AND (CAST(:hasta AS timestamp) IS NULL OR fecha_hora < CAST(:hasta AS timestamp))) AS reaperturas,
          (SELECT COUNT(*) FROM bitacora_general WHERE tabla_afectada='cajas'
             AND accion='INCIDENCIA'
             AND (CAST(:desde AS timestamp) IS NULL OR fecha_hora >= CAST(:desde AS timestamp))
             AND (CAST(:hasta AS timestamp) IS NULL OR fecha_hora < CAST(:hasta AS timestamp))) AS incidencias
    """, desde=desde, hasta=hasta)


def trazabilidad(cx, numero_serie):
    return uno(cx, """
        SELECT u.id_unidad,u.numero_serie,u.estado,u.fecha_hora,
               u.id_color,co.nombre AS color,u.id_linea,u.id_turno,
               l.id_orden,o.id_modelo,m.nombre AS modelo,
               o.id_cliente,cl.nombre AS cliente,u.id_caja,c.id_embarque,
               e.referencia AS referencia_embarque,e.fecha_salida,
               (SELECT q.estado FROM calidad q WHERE q.id_unidad=u.id_unidad
                ORDER BY q.fecha DESC NULLS LAST,q.id_calidad DESC LIMIT 1) AS estado_calidad
        FROM unidades u JOIN colores co ON co.id_color=u.id_color
        JOIN lote l ON l.id_lote=u.id_lote
        JOIN ordenes o ON o.id_orden=l.id_orden
        JOIN modelos m ON m.id_modelo=o.id_modelo
        JOIN clientes cl ON cl.id_cliente=o.id_cliente
        LEFT JOIN cajas c ON c.id_caja=u.id_caja
        LEFT JOIN embarques e ON e.id_embarque=c.id_embarque
        WHERE u.numero_serie=:serie
    """, serie=numero_serie)


def incidencias(cx):
    return todos(cx, """
        SELECT id_bitacora, id_registro_afectado AS id_caja,
               id_usuario, valor_nuevo AS tipo, motivo, fecha_hora
        FROM bitacora_general
        WHERE tabla_afectada='cajas' AND accion='INCIDENCIA'
        ORDER BY fecha_hora DESC, id_bitacora DESC
    """)


def solicitudes_reapertura(cx, id_caja):
    return todos(cx, """
        SELECT id_autorizacion, id_usuario_solicita, id_usuario_autoriza,
               id_referencia, tipo_referencia, motivo, estado,
               fecha_solicitud, fecha_autorizacion
        FROM autorizacion
        WHERE tipo_referencia='CAJA' AND id_referencia=:id
        ORDER BY fecha_solicitud DESC, id_autorizacion DESC
    """, id=id_caja)

def quitar_caja_embarque(cx, id_caja, id_embarque):
    return ejecutar(cx, """
        UPDATE cajas SET id_embarque=NULL
        WHERE id_caja=:caja AND id_embarque=:embarque AND estado='CERRADA'
    """, caja=id_caja, embarque=id_embarque).rowcount


def historial_unidad(cx, id_unidad):
    """Eventos de Almacén por unidad; permanecen aunque se retire de una caja."""
    return todos(cx, """
        SELECT id_bitacora, id_usuario, accion, valor_anterior, valor_nuevo,
               motivo, fecha_hora
        FROM bitacora_general
        WHERE tabla_afectada='unidades' AND id_registro_afectado=:id
        ORDER BY fecha_hora ASC NULLS LAST, id_bitacora ASC
    """, id=id_unidad)


def historial_embarque(cx, id_embarque):
    """Eventos de creación, asignación/retiro de cajas y salida de embarque."""
    return todos(cx, """
        SELECT id_bitacora, id_usuario, accion, valor_anterior,
               valor_nuevo, motivo, fecha_hora
        FROM bitacora_general
        WHERE tabla_afectada='embarques' AND id_registro_afectado=:id
        ORDER BY fecha_hora DESC NULLS LAST, id_bitacora DESC
    """, id=id_embarque)
