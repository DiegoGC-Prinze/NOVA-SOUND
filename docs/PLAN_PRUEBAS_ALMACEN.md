# NOVA SOUND · Matriz de pruebas v1.0 · Empaque y Embarques

**Regla:** un caso está **APROBADO** únicamente tras ejecutarse con evidencia verificable. El resultado esperado no equivale a una ejecución.

| ID | Caso | Resultado esperado | Evidencia real |
|---|---|---|---|
| CAT-01 | Listar catálogo | Solo NS-MINI, NS-SPORT, NS-PRO, NS-MAX | Pendiente |
| CAT-02 | Capacidades | MINI 12, SPORT 8, PRO 6, MAX 4 | Pendiente |
| EMP-01 | Crear caja MINI | HTTP 201, capacidad 12, EN_PROCESO | Pendiente |
| EMP-02 | Crear caja PRO | HTTP 201, capacidad 6 | Pendiente |
| EMP-03 | Empacar unidad liberada | HTTP 200, estado EMPACADA | Pendiente |
| EMP-04 | Empacar unidad retenida | HTTP 409 sin cambios | Pendiente |
| EMP-05 | Empacar unidad de otro modelo/orden | HTTP 409 | Pendiente |
| EMP-06 | Doble escaneo concurrente | Solo un éxito; otra solicitud HTTP 409 | Pendiente |
| EMP-07 | Mezcla de colores prohibida | HTTP 409 | Pendiente |
| EMP-08 | Exceder capacidad | HTTP 409 | Pendiente |
| EMP-09 | Retirar unidad | Unidad vuelve a LIBERADA; se conserva historial de caja | Pendiente |
| EMP-10 | Cerrar caja válida | CERRADA y fecha_cierre | Pendiente |
| EMP-11 | Modificar caja cerrada | HTTP 409 | Pendiente |
| EMP-12 | Reapertura por solicitante | HTTP 403 | Pendiente |
| EMP-13 | Reapertura por supervisor distinto | EN_PROCESO; bitácora con autor | Pendiente |
| EMB-01 | Crear embarque | HTTP 201, PREPARACION | Pendiente |
| EMB-02 | Incorporar caja cerrada de otra orden/cliente | HTTP 409 | Pendiente |
| EMB-03 | Incorporar caja correcta | HTTP 200 y asociación correcta | Pendiente |
| EMB-04 | Registrar salida válida | ENVIADO, fecha_salida, cajas/unidades EMBARCADA | Pendiente |
| EMB-05 | Registrar doble salida | HTTP 409 | Pendiente |
| EMB-06 | Consultar historial de embarque | Creación, asignación, salida, usuario/fecha | Pendiente |
| TRA-01 | Trazabilidad antes y después de envío | Modelo, orden, color, caja, embarque, eventos ordenados | Pendiente |
| TRA-02 | Trazabilidad tras retiro | `id_caja` actual NULL pero evento con ID caja original | Pendiente |
| AUD-01 | Eventos de unidad por operación | `tabla_afectada='unidades'`, `id_registro_afectado=id_unidad` | Pendiente |
| SEG-01 | GET lecturas en Swagger | HTTP 200 según datos | Pendiente |
| SEG-02 | POST sin sesión ni demo | HTTP 401 | Pendiente |
| SEG-03 | Usuario solo de Calidad solicita escritura | HTTP 403 | Pendiente |

## Suites preparadas

**Unitarias y contrato (sin PG real):**

```bash
cd backend
python -m pytest -q tests/test_almacen.py
```

**Integración (PostgreSQL real, base separada):**

```bash
bash backend/scripts/preparar_bd_pruebas.sh  # desde raiz repo; una sola vez
cd backend
ALMACEN_RUN_INTEGRATION=1 python -m pytest -q tests/test_almacen_integracion.py
```

**Estado al producir este paquete:** 16/16 pruebas unitarias aprobadas en entorno aislado de construcción; 6 pruebas PostgreSQL redactadas pero **no ejecutadas**. Las seis se omiten por seguridad sin `ALMACEN_RUN_INTEGRATION=1`.

## Registro de evidencia recomendado

Para cada test documentar: ID, fecha/hora, commit, escenario, IDs reales de orden/serie/caja/embarque, resultado esperado, código HTTP observado, resultado de consulta SQL, captura de Swagger o pytest, PASS/FAIL y observaciones. Evitar registrar contraseñas o tokens.

## Criterios de entrega

- Pruebas unitarias + integración sin fallos.
- Catálogo oficial consistente en DB real y test.
- Trazabilidad de una unidad hasta un embarque enviado, con bitácora y responsable.
- Ninguna unidad retenida o de modelo/orden diferente es empacada.
- Reapertura bloqueada sin autorización, autorizada por supervisor distinto.
- Login real de Carlos y pantallas de Frontend verificados en entorno compartido.
