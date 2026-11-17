"""Permisos reales del inspector; nunca se confía en el ID enviado por el cliente."""
from app.core.acceso import exigir
ACCION = 'dar-disposicion-de-calidad-liberar-retener-retrabajo-scrap'
PANTALLAS = ['calidad/'+p for p in ['resumen-de-calidad','inspeccion-de-unidad','retenciones','retrabajos','historial-de-la-unidad','reportes-de-calidad']]


def verificar_permisos_inspector(actor, pantalla='inspeccion-de-unidad'):
    exigir(actor, 'calidad/'+pantalla, escribir=True, accion=ACCION)
