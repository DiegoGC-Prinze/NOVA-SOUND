# NOVA SOUND - Simulacion industrial (Etapa 1)

Esta primera entrega **no inyecta datos** en PostgreSQL ni llama a FastAPI. Genera
un plan reproducible de 30 dias de operacion, incluyendo dias habiles,
lineas, turnos, paros, faltantes de material, resultados funcionales y disposiciones
de Calidad. Sus porcentajes son hipotesis ilustrativas; no datos medidos de planta.

## Uso en Fedora

Copiar los archivos del paquete a la raiz del repositorio, estando en
`feature/simulacion-industrial`.

```bash
python3 scripts/simulacion/simular.py --salida resultados/simulacion
python3 -m unittest discover -s tests -p 'test_simulacion.py' -v
```

Salidas: `escenario.json`, `turnos.csv`, `incidencias.csv`, `unidades.csv`.
El formato `estado_previsto` significa una ruta de proceso planeada, **no** un estado
actual en NOVA SOUND. El valor `fecha_simulada` no se inserta en el sistema.

## Proximas etapas

- Cliente HTTP para login con cuentas reales y ejecucion de Produccion, Pruebas y Calidad.
- Manejo de fallas, retenciones, retrabajo e inspecciones conforme a la API.
- Planificacion de cajas y embarques con capacidades oficiales y reglas de cliente/orden.
- Reloj simulado seguro y exclusivo del ambiente de pruebas para registrar historicos.
- Pruebas end-to-end y validacion de trazabilidad por numero de serie.

**Seguridad:** utilizar un proyecto Docker/volumen de simulacion aislado. Nunca
escribir fechas ficticias ni datos sinteticos en el volumen del proyecto actual.
