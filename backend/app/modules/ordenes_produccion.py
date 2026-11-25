"""Emision de ordenes desde Gerencia al flujo existente de Produccion."""
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StrictInt

from app.core.acceso import actor_actual, exigir
from app.modules import gestion as g
from app.modules.almacen.repository import ejecutar, todos

PANTALLA = 'gerencia/ordenes-de-produccion'
ACCION = 'enviar-orden-a-produccion'
router = APIRouter(prefix='/api/v1/gestion/ordenes-produccion', tags=['Ordenes de produccion'])


class OrdenEnviar(BaseModel):
    id_cliente: StrictInt = Field(gt=0)
    id_modelo: StrictInt = Field(gt=0)
    id_color: StrictInt = Field(gt=0)
    id_linea: StrictInt = Field(gt=0)
    cantidad: StrictInt = Field(gt=0, le=2147483647)
    fecha_compromiso: date


@router.get('/acceso')
def acceso(actor=Depends(actor_actual)):
    nivel = (actor['permisos'] or {}).get(PANTALLA)
    nivel = nivel if nivel in {'ver', 'acciona'} else None
    return {'nivel': nivel, 'puedeEnviar': nivel == 'acciona' and ACCION in (actor['acciones'] or [])}


@router.get('')
def consultar(actor=Depends(actor_actual)):
    exigir(actor, PANTALLA)
    with g.db() as cx:
        catalogos = g.leer_catalogos(cx, True)
        return {'fecha': g.hoy(cx).isoformat(), 'ordenes': g.ordenes(cx),
                **{tipo: [{'id': i['id'], 'nombre': i['nombre'], 'codigo': i['codigo']}
                          for i in catalogos[tipo]['items']]
                   for tipo in ('clientes', 'modelos', 'lineas')},
                'colores': todos(cx, 'SELECT id_color AS id,nombre FROM colores ORDER BY nombre')}


@router.post('', status_code=201)
def enviar(datos: OrdenEnviar, actor=Depends(actor_actual)):
    exigir(actor, PANTALLA, escribir=True, accion=ACCION)
    with g.db() as cx:
        if datos.fecha_compromiso < g.hoy(cx):
            g.error(422, 'La fecha de compromiso debe ser hoy o una fecha posterior.')
        for tipo, valor in [('clientes', datos.id_cliente), ('modelos', datos.id_modelo), ('lineas', datos.id_linea)]:
            g.catalogo_activo(cx, tipo, valor)
        if not ejecutar(cx, 'SELECT 1 FROM colores WHERE id_color=:id', id=datos.id_color).first():
            g.error(422, 'El color seleccionado no existe.')
        oid = ejecutar(cx, '''INSERT INTO ordenes
            (id_cliente,id_modelo,id_color,id_linea,cantidad,fecha_compromiso,fecha_inicio)
            VALUES (:id_cliente,:id_modelo,:id_color,:id_linea,:cantidad,:fecha_compromiso,'''
            + g.AHORA + ') RETURNING id_orden', **datos.model_dump()).scalar_one()
        g.auditar(cx, actor, 'ordenes', oid, 'ENVIAR_ORDEN_PRODUCCION',
                  despues=datos.model_dump(mode='json'))
        return next(o for o in g.ordenes(cx) if o['id_orden'] == oid)


def incorporar_permiso(db_engine):
    """Agrega la seccion a Gerencia y a administradores que ya acceden a esa area."""
    with db_engine.begin() as cx:
        ejecutar(cx, "SELECT pg_advisory_xact_lock(hashtextextended('administracion-usuarios-roles',0))")
        for clave, condicion in [
            ('permiso-ordenes-produccion-v1', "nombre='Gerencia'"),
            ('permiso-ordenes-administrador-v1',
             "nombre='Administrador' AND permisos->>'gerencia/dashboard' IN ('ver','acciona')"),
        ]:
            nuevo = ejecutar(cx, '''INSERT INTO configuracion_web(clave,valor,motivo)
                VALUES (:clave,'true'::jsonb,'Acceso a ordenes de produccion desde Gerencia')
                ON CONFLICT DO NOTHING RETURNING clave''', clave=clave).first()
            if nuevo:
                ejecutar(cx, '''UPDATE roles SET
                    permisos=CASE WHEN COALESCE(permisos,'{}'::jsonb) ? :p THEN permisos
                        ELSE COALESCE(permisos,'{}'::jsonb) || jsonb_build_object(:p, 'acciona'::text) END,
                    acciones=CASE WHEN COALESCE(acciones,'[]'::jsonb) ? :a THEN acciones
                        ELSE COALESCE(acciones,'[]'::jsonb) || jsonb_build_array(CAST(:a AS text)) END
                    WHERE ''' + condicion, p=PANTALLA, a=ACCION)
