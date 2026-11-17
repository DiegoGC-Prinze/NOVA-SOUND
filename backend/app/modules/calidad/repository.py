"""Consultas de Calidad dentro de la transacción de su unidad."""
from app.modules.almacen.repository import todos, uno, ejecutar


def obtener_unidad_por_serie(cx, serie, bloquear=False):
    return uno(cx,'SELECT * FROM unidades WHERE numero_serie=:s'+(' FOR UPDATE' if bloquear else ''),s=serie.strip())


def ultima_inspeccion(cx, uid):
    return uno(cx,'''SELECT q.*,u.nombre AS inspector FROM calidad q JOIN usuarios u USING(id_usuario)
        WHERE q.id_unidad=:id ORDER BY q.fecha DESC,q.id_calidad DESC LIMIT 1''',id=uid)


def ultima_prueba(cx, uid):
    return uno(cx,'SELECT * FROM pruebas WHERE id_unidad=:id ORDER BY fecha DESC,id_prueba DESC LIMIT 1',id=uid)


def ultimo_retrabajo(cx, uid):
    return uno(cx,'SELECT * FROM retrabajo WHERE id_unidad=:id ORDER BY id_retrabajo DESC LIMIT 1',id=uid)


def defectos_inspeccion(cx, qid):
    return todos(cx,'''SELECT d.*,c.nombre AS categoria FROM defectos d JOIN cat_defectos c USING(id_categoria)
        WHERE id_calidad=:id ORDER BY id_defecto''',id=qid)


def obtener_categorias_defectos(cx):
    return todos(cx,'SELECT id_categoria,nombre FROM cat_defectos ORDER BY id_categoria')
