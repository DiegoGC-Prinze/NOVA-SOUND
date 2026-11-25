-- Se ejecuta tras COPY de unidades_plan, dentro de la misma transacción.
DO $$
BEGIN
    IF current_database() = 'nova_sounds_simulacion'
       OR current_database() !~ '^nova_[a-z0-9_]+_simulacion$'
       OR EXISTS (SELECT 1 FROM unidades) THEN
        RAISE EXCEPTION 'La carga requiere una base de simulación de reemplazo vacía';
    END IF;
END $$;

CREATE TEMP TABLE responsables AS
SELECT r.nombre AS rol, min(u.id_usuario) AS id
FROM usuarios u JOIN roles r USING (id_rol)
WHERE u.activo AND u.estado = 'Activo'
GROUP BY r.nombre;

DO $$
BEGIN
    IF (SELECT count(*) FROM responsables WHERE rol IN
        ('Operador / Pruebas Funcionales','Líder de línea','Calidad','Almacén/Empaque','Embarques')) <> 5 THEN
        RAISE EXCEPTION 'La base de presentación debe tener cuentas activas en los cinco roles operativos';
    END IF;
END $$;

CREATE TEMP TABLE lotes_plan AS
WITH lineas AS (
    SELECT id_linea, row_number() OVER (ORDER BY id_linea) - 1 AS pos FROM linea LIMIT 3
), modelos_capacidad AS (
    SELECT m.id_modelo, (cfg.valor->>m.nombre)::int AS capacidad
    FROM modelos m CROSS JOIN configuracion_web cfg
    WHERE cfg.clave='capacidadCaja' AND (cfg.valor->>m.nombre)::int > 0
), modelos AS (
    SELECT *, row_number() OVER (ORDER BY id_modelo) - 1 AS pos FROM modelos_capacidad LIMIT 4
)
SELECT row_number() OVER (ORDER BY p.fecha, p.turno, p.linea_pos, p.modelo_pos)::int AS id_lote,
       dense_rank() OVER (ORDER BY l.id_linea, m.id_modelo)::int AS id_orden,
       p.fecha,p.turno,p.linea_pos,p.modelo_pos,l.id_linea,m.id_modelo,m.capacidad,
       count(*)::int AS cantidad,
       ceil(count(*) * (1.00 + ((min(p.id_unidad) % 9) - 3) / 100.0))::int AS meta,
       p.fecha + CASE WHEN p.turno=1 THEN time '06:00' ELSE time '14:00' END AS inicio
FROM unidades_plan p
LEFT JOIN lineas l ON l.pos=p.linea_pos
LEFT JOIN modelos m ON m.pos=p.modelo_pos
GROUP BY p.fecha,p.turno,p.linea_pos,p.modelo_pos,l.id_linea,m.id_modelo,m.capacidad;

INSERT INTO ordenes(id_orden,id_cliente,id_modelo,id_color,id_linea,cantidad,fecha_inicio,fecha_compromiso)
SELECT id_orden,(SELECT min(id_cliente) FROM clientes),id_modelo,(SELECT min(id_color) FROM colores),
       id_linea,sum(meta),min(inicio),max(fecha)+4
FROM lotes_plan GROUP BY id_orden,id_modelo,id_linea;

INSERT INTO lote(id_lote,id_orden,cantidad_acordada,estado,fecha_creacion,codigo)
SELECT id_lote,id_orden,meta,'EN_PROCESO',inicio,'NOV26-L-'||id_lote FROM lotes_plan;

INSERT INTO objetivo_unidades(id_orden,id_linea,id_turno,cantidad_objetivo,fecha)
SELECT id_orden,id_linea,turno,meta,fecha FROM lotes_plan;

INSERT INTO ensamble(id_usuario,id_turno,id_linea,id_lote,cantidad,fecha_ensamble)
SELECT (SELECT id FROM responsables WHERE rol='Operador / Pruebas Funcionales'),
       turno,id_linea,id_lote,cantidad,inicio FROM lotes_plan;

CREATE TEMP TABLE produccion_plan AS
SELECT p.id_unidad,p.estado,p.empacar,p.falla,l.id_lote,l.id_orden,l.id_linea,l.id_modelo,
       l.turno,l.inicio,l.capacidad,
       l.inicio + p.minuto * interval '1 minute' AS ensamblada,
       CASE WHEN p.empacar THEN
         sum(p.empacar::int) OVER (PARTITION BY l.id_lote ORDER BY p.id_unidad ROWS UNBOUNDED PRECEDING)
       END AS posicion
FROM unidades_plan p JOIN lotes_plan l USING (fecha,turno,linea_pos,modelo_pos);

CREATE TEMP TABLE cajas_plan AS
WITH grupos AS (
    SELECT id_lote,id_orden,id_modelo,capacidad,
           ((posicion - 1) / capacidad)::int AS posicion_caja,
           max(ensamblada) + interval '50 minutes' AS fecha_caja
    FROM produccion_plan WHERE empacar
    GROUP BY id_lote,id_orden,id_modelo,capacidad,((posicion - 1) / capacidad)::int
)
SELECT row_number() OVER (ORDER BY id_lote,posicion_caja)::int AS id_caja, grupos.*,
       dense_rank() OVER (ORDER BY id_lote,posicion_caja / 8)::int AS id_embarque
FROM grupos;

CREATE TEMP TABLE embarques_plan AS
SELECT id_embarque,id_orden,max(fecha_caja) + interval '10 minutes' AS fecha_embarque,
       CASE WHEN id_embarque % 20 < 9 THEN 'ENTREGADO'
            WHEN id_embarque % 20 < 11 THEN 'DEVUELTO'
            WHEN id_embarque % 20 < 13 THEN 'PENDIENTE'
            WHEN id_embarque % 20 < 17 THEN 'PREPARACION'
            ELSE 'ENVIADO' END AS estado
FROM cajas_plan GROUP BY id_embarque,id_orden;

-- Las fechas de almacén se guardan en UTC; Producción y Calidad usan hora de planta.
INSERT INTO embarques(id_embarque,id_cliente,id_orden,fecha_salida,referencia,estado,destino,contenedor,fecha_creacion)
SELECT e.id_embarque,o.id_cliente,e.id_orden,
       CASE WHEN e.estado IN ('ENTREGADO','DEVUELTO','ENVIADO')
            THEN (e.fecha_embarque + interval '10 minutes') AT TIME ZONE 'America/Monterrey' AT TIME ZONE 'UTC' END,
       'SIM-NOV26-'||e.id_embarque,e.estado,
       (ARRAY['Monterrey','Saltillo','Querétaro','Guadalajara'])[1 + e.id_embarque % 4],
       'SIM-CONT-'||e.id_embarque,e.fecha_embarque AT TIME ZONE 'America/Monterrey' AT TIME ZONE 'UTC'
FROM embarques_plan e JOIN ordenes o USING (id_orden);

INSERT INTO cajas(id_caja,id_cliente,id_modelo,id_embarque,estado,id_orden,capacidad,fecha_creacion,fecha_cierre)
SELECT c.id_caja,o.id_cliente,c.id_modelo,
       CASE WHEN e.estado <> 'PENDIENTE' THEN c.id_embarque END,
       CASE WHEN e.estado IN ('ENTREGADO','DEVUELTO','ENVIADO') THEN 'EMBARCADA' ELSE 'CERRADA' END,
       c.id_orden,c.capacidad,
       c.fecha_caja AT TIME ZONE 'America/Monterrey' AT TIME ZONE 'UTC',
       (c.fecha_caja + interval '5 minutes') AT TIME ZONE 'America/Monterrey' AT TIME ZONE 'UTC'
FROM cajas_plan c JOIN embarques_plan e USING (id_embarque) JOIN ordenes o ON o.id_orden=c.id_orden;

INSERT INTO unidades(id_unidad,id_color,id_linea,id_turno,id_caja,id_lote,estado,fecha_hora,numero_serie,id_usuario_registro)
SELECT p.id_unidad,o.id_color,p.id_linea,p.turno,c.id_caja,p.id_lote,
       CASE WHEN c.estado='EMBARCADA' THEN 'EMBARCADA' WHEN c.id_caja IS NOT NULL THEN 'EMPACADA' ELSE p.estado END,
       p.ensamblada,'SIM-NOV26-'||lpad(p.id_unidad::text,8,'0'),
       (SELECT id FROM responsables WHERE rol='Operador / Pruebas Funcionales')
FROM produccion_plan p JOIN ordenes o USING (id_orden)
LEFT JOIN cajas_plan cp ON cp.id_lote=p.id_lote AND cp.posicion_caja=((p.posicion-1)/p.capacidad)::int
LEFT JOIN cajas c ON c.id_caja=cp.id_caja;

INSERT INTO pruebas(id_unidad,fecha,resultado,resultados,observaciones,id_usuario)
SELECT id_unidad,ensamblada + interval '15 minutes',
       CASE WHEN estado='FALLA_FUNCIONAL' THEN 'RECHAZADA' ELSE 'APROBADA' END,
       jsonb_build_object(
           'encendido',CASE WHEN estado='FALLA_FUNCIONAL' AND falla=0 THEN 'Falla' ELSE 'Aprobada' END,
           'audio',CASE WHEN estado='FALLA_FUNCIONAL' AND falla=1 THEN 'Falla' ELSE 'Aprobada' END,
           'carga',CASE WHEN estado='FALLA_FUNCIONAL' AND falla=2 THEN 'Falla' ELSE 'Aprobada' END,
           'bluetooth',CASE WHEN estado='FALLA_FUNCIONAL' AND falla=3 THEN 'Falla' ELSE 'Aprobada' END),
       CASE WHEN estado='FALLA_FUNCIONAL' THEN 'Falla funcional simulada' ELSE '' END,
       (SELECT id FROM responsables WHERE rol='Operador / Pruebas Funcionales')
FROM produccion_plan WHERE estado <> 'ENSAMBLADA';

INSERT INTO calidad(id_calidad,id_unidad,id_usuario,estado,fecha)
SELECT id_unidad,id_unidad,(SELECT id FROM responsables WHERE rol='Calidad'),
       estado,ensamblada + interval '35 minutes'
FROM produccion_plan WHERE estado IN ('LIBERADA','EN_RETENCION','RETRABAJO','SCRAP');

WITH disponibles AS (
    SELECT cd.id_categoria,d.nombre,row_number() OVER (ORDER BY cd.id_categoria,d.nombre) AS pos
    FROM catalogos_web d JOIN catalogos_web c
      ON c.tipo='categorias' AND d.codigo LIKE c.codigo||'-%'
    JOIN cat_defectos cd ON cd.id_categoria=c.id_original
    WHERE d.tipo='defectos' AND d.activo AND c.activo
)
INSERT INTO defectos(id_calidad,id_categoria,causa,nombre)
SELECT q.id_calidad,d.id_categoria,'Defecto de inspección simulado',d.nombre
FROM calidad q JOIN disponibles d ON d.pos=1+(q.id_calidad % (SELECT count(*) FROM disponibles))
WHERE q.estado <> 'LIBERADA';

INSERT INTO retrabajo(id_unidad,id_calidad,descripcion,fecha,id_usuario)
SELECT id_unidad,id_calidad,'Pendiente de corrección',fecha + interval '5 minutes',id_usuario
FROM calidad WHERE estado='RETRABAJO';

INSERT INTO cierresturno(id_usuario,id_linea,id_turno,fecha,total_empacadas,
       total_retenidas,total_retrabajo,total_scrap,total_reportadas,estado,origen_web,nota)
SELECT (SELECT id FROM responsables WHERE rol='Líder de línea'),u.id_linea,u.id_turno,
       min(l.inicio) + interval '7 hours 55 minutes',
       count(*) FILTER (WHERE u.estado IN ('EMPACADA','EMBARCADA')),
       count(*) FILTER (WHERE u.estado='EN_RETENCION'),
       count(*) FILTER (WHERE u.estado='RETRABAJO'),count(*) FILTER (WHERE u.estado='SCRAP'),
       count(*),'Cerrado',TRUE,'Cierre del periodo simulado'
FROM unidades u JOIN lotes_plan l USING (id_lote)
GROUP BY l.fecha,u.id_linea,u.id_turno;

INSERT INTO incidencias_web(id_usuario,id_linea,tipo,severidad,paro,motivo,fecha)
SELECT (SELECT id FROM responsables WHERE rol='Líder de línea'),id_linea,
       CASE WHEN id_lote % 2=0 THEN 'Equipo' ELSE 'Material' END,'Media',
       5+id_lote%30,'Incidencia simulada',inicio + interval '10 minutes'
FROM lotes_plan WHERE id_lote % 7=1;

INSERT INTO tickets_web(num_empleado,nombre,motivo,fecha,estado)
SELECT u.usuario,u.nombre,'Cuenta bloqueada',
       (SELECT min(fecha) FROM lotes_plan) + time '08:00','Abierto'
FROM responsables r JOIN usuarios u ON u.id_usuario=r.id WHERE r.rol IN ('Operador / Pruebas Funcionales','Calidad');

INSERT INTO autorizacion(id_usuario_solicita,id_referencia,tipo_referencia,motivo,estado,fecha_solicitud,datos)
SELECT c.id_usuario,c.id_cierre,'PRODUCCION_WEB','Revisión de conteo del periodo simulado',
       'Pendiente',c.fecha + interval '1 minute',
       jsonb_build_object('tipo','Reapertura de turno','orden',min(l.id_orden)::text,
          'linea',COALESCE(cl.codigo,'L'||c.id_linea),'idLinea',c.id_linea,'turno',c.id_turno,
          'fechaTurno',c.fecha::date,'idCierre',c.id_cierre,'revisionCierre',c.revision,'cambio',NULL)
FROM cierresturno c JOIN lotes_plan l ON l.fecha=c.fecha::date AND l.turno=c.id_turno AND l.id_linea=c.id_linea
LEFT JOIN catalogos_web cl ON cl.tipo='lineas' AND cl.id_original=c.id_linea
WHERE c.id_cierre % 37=1
GROUP BY c.id_cierre,cl.codigo;

INSERT INTO bitacora_general(id_usuario,id_registro_afectado,accion,tabla_afectada,valor_nuevo,fecha_hora)
SELECT (SELECT id FROM responsables WHERE rol='Embarques'),c.id_caja,
       'ASIGNAR_EMBARQUE','cajas','Embarque='||c.id_embarque,e.fecha_creacion + interval '1 minute'
FROM cajas c JOIN embarques e USING (id_embarque);

INSERT INTO bitacora_general(id_usuario,id_registro_afectado,accion,tabla_afectada,valor_nuevo,fecha_hora)
SELECT (SELECT id FROM responsables WHERE rol='Embarques'),c.id_caja,
       'VERIFICAR_ESTIBA','cajas','Embarque='||c.id_embarque,e.fecha_creacion + interval '2 minutes'
FROM cajas c JOIN embarques e USING (id_embarque) WHERE c.estado='EMBARCADA';

CREATE INDEX IF NOT EXISTS ix_periodo_pruebas_unidad ON pruebas(id_unidad);
CREATE INDEX IF NOT EXISTS ix_periodo_calidad_unidad ON calidad(id_unidad);
CREATE INDEX IF NOT EXISTS ix_periodo_defectos_calidad ON defectos(id_calidad);
CREATE INDEX IF NOT EXISTS ix_periodo_retrabajo_unidad ON retrabajo(id_unidad);
CREATE INDEX IF NOT EXISTS ix_periodo_cajas_embarque ON cajas(id_embarque);

DO $$
BEGIN
    IF (SELECT count(*) FROM unidades) <> (SELECT count(*) FROM unidades_plan)
       OR EXISTS (SELECT 1 FROM unidades_plan p LEFT JOIN unidades u USING(id_unidad)
          WHERE u.id_unidad IS NULL OR u.fecha_hora::date<>p.fecha OR u.id_turno<>p.turno)
       OR (SELECT sum(total_reportadas) FROM cierresturno) <> (SELECT count(*) FROM unidades)
       OR EXISTS (SELECT 1 FROM cajas c JOIN unidades u USING (id_caja) JOIN lote l USING (id_lote)
          WHERE c.id_orden<>l.id_orden OR u.estado NOT IN ('EMPACADA','EMBARCADA'))
       OR EXISTS (SELECT 1 FROM cajas c JOIN unidades u USING (id_caja)
          GROUP BY c.id_caja HAVING count(*) > c.capacidad)
       OR EXISTS (SELECT 1 FROM produccion_plan p
          WHERE (p.estado<>'ENSAMBLADA') <> EXISTS (SELECT 1 FROM pruebas q WHERE q.id_unidad=p.id_unidad))
       OR EXISTS (SELECT 1 FROM calidad q WHERE q.estado<>'LIBERADA'
          AND NOT EXISTS (SELECT 1 FROM defectos d WHERE d.id_calidad=q.id_calidad)) THEN
        RAISE EXCEPTION 'La carga no cumple las comprobaciones de integridad';
    END IF;
END $$;

SELECT setval(pg_get_serial_sequence('ordenes','id_orden'),max(id_orden)) FROM ordenes;
SELECT setval(pg_get_serial_sequence('lote','id_lote'),max(id_lote)) FROM lote;
SELECT setval(pg_get_serial_sequence('embarques','id_embarque'),max(id_embarque)) FROM embarques HAVING max(id_embarque) IS NOT NULL;
SELECT setval(pg_get_serial_sequence('cajas','id_caja'),max(id_caja)) FROM cajas HAVING max(id_caja) IS NOT NULL;
SELECT setval(pg_get_serial_sequence('unidades','id_unidad'),max(id_unidad)) FROM unidades;
SELECT setval(pg_get_serial_sequence('calidad','id_calidad'),max(id_calidad)) FROM calidad HAVING max(id_calidad) IS NOT NULL;
COMMIT;
ANALYZE;
