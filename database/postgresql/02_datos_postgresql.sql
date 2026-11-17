-- NOVA SOUND: datos de ejemplo adaptados de MySQL a PostgreSQL.
-- Ejecutar DESPUES de 01_esquema_postgresql.sql, en base nova_sounds vacia.
-- Conserva los registros originales; NO ejecutar repetidamente.
-- Advertencia: 'pass123' es dato de prueba, NO una contrasena segura.

BEGIN;

-- 1. CATÁLOGOS BASE
INSERT INTO Roles (id_rol, nombre) VALUES
(1, 'Administrador'),
(2, 'Operador'),
(3, 'Inspector Calidad');

INSERT INTO Usuarios (id_usuario, id_rol, nombre, usuario, contrasena) VALUES
(1, 1, 'Admin General', 'admin', 'pass123'),
(2, 2, 'Juan Perez', 'jperez', 'pass123'),
(3, 3, 'Carlos López', 'clopez', 'pass123');

INSERT INTO Clientes (id_cliente, nombre, mezcla_colores) VALUES
(1, 'Cliente Principal', TRUE);

INSERT INTO Modelos (id_modelo, nombre) VALUES
(1, 'NS-MINI'),
(2, 'NS-SPORT'),
(3, 'NS-PRO'),
(4, 'NS-MAX');

INSERT INTO Colores (id_color, nombre) VALUES
(1, 'Negro'),
(2, 'Blanco'),
(3, 'Azul'),
(4, 'Rojo');

INSERT INTO Linea (id_linea, nombre) VALUES
(1, 'Línea 1'),
(2, 'Línea 2'),
(3, 'Línea 3');

INSERT INTO Turnos (id_turno, hora_inicio, hora_fin) VALUES
(1, '07:00:00', '15:00:00'),
(2, '15:00:00', '23:00:00');

INSERT INTO CAT_DEFECTOS (id_categoria, nombre) VALUES
(1, 'Apariencia / Estética'),
(2, 'Falla Funcional / Componente');

INSERT INTO Ordenes (id_orden, id_cliente, id_modelo, id_color, id_linea, cantidad, fecha_compromiso) VALUES
(1, 1, 1, 1, 1, 1000, '2026-10-01');

INSERT INTO Lote (id_lote, id_orden, cantidad_acordada, estado) VALUES
(1, 1, 500, 'EN_PROCESO');

INSERT INTO Cajas (id_caja, id_cliente, id_modelo, estado) VALUES
(1, 1, 1, 'LLENA');


-- 2. POBLADO DE 50 UNIDADES
-- Bloque 1: Unidades Aprobadas y Liberadas (SN-2026-0005 a SN-2026-0014)
INSERT INTO Unidades (id_color, id_linea, id_turno, id_caja, id_lote, estado, fecha_hora, numero_serie) VALUES
(1, 1, 1, 1, 1, 'EMPACADA', '2026-09-23 08:00:00', 'SN-2026-0005'),
(2, 1, 1, 1, 1, 'EMPACADA', '2026-09-23 08:02:00', 'SN-2026-0006'),
(1, 1, 1, 1, 1, 'EMPACADA', '2026-09-23 08:05:00', 'SN-2026-0007'),
(3, 1, 1, 1, 1, 'EMPACADA', '2026-09-23 08:07:00', 'SN-2026-0008'),
(4, 1, 1, NULL, 1, 'LIBERADA', '2026-09-23 08:10:00', 'SN-2026-0009'),
(1, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 08:12:00', 'SN-2026-0010'),
(2, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 08:15:00', 'SN-2026-0011'),
(3, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 08:18:00', 'SN-2026-0012'),
(1, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 08:20:00', 'SN-2026-0013'),
(2, 3, 1, NULL, 1, 'LIBERADA', '2026-09-23 08:22:00', 'SN-2026-0014');

-- Bloque 2: Unidades en Retención (SN-2026-0015 a SN-2026-0019)
INSERT INTO Unidades (id_color, id_linea, id_turno, id_caja, id_lote, estado, fecha_hora, numero_serie) VALUES
(1, 3, 1, NULL, 1, 'EN_RETENCION', '2026-09-23 08:25:00', 'SN-2026-0015'),
(2, 1, 1, NULL, 1, 'EN_RETENCION', '2026-09-23 08:28:00', 'SN-2026-0016'),
(3, 2, 1, NULL, 1, 'EN_RETENCION', '2026-09-23 08:30:00', 'SN-2026-0017'),
(4, 3, 1, NULL, 1, 'EN_RETENCION', '2026-09-23 08:32:00', 'SN-2026-0018'),
(1, 1, 2, NULL, 1, 'EN_RETENCION', '2026-09-23 14:10:00', 'SN-2026-0019');

-- Bloque 3: Unidades en Retrabajo y Scrap (SN-2026-0020 a SN-2026-0023)
INSERT INTO Unidades (id_color, id_linea, id_turno, id_caja, id_lote, estado, fecha_hora, numero_serie) VALUES
(2, 1, 2, NULL, 1, 'EN_RETRABAJO', '2026-09-23 14:15:00', 'SN-2026-0020'),
(3, 2, 2, NULL, 1, 'EN_RETRABAJO', '2026-09-23 14:20:00', 'SN-2026-0021'),
(1, 3, 2, NULL, 1, 'SCRAP',        '2026-09-23 14:25:00', 'SN-2026-0022'),
(4, 1, 2, NULL, 1, 'SCRAP',        '2026-09-23 14:30:00', 'SN-2026-0023');

-- Bloque 4: Producción Turno 1 (SN-2026-0024 a SN-2026-0035)
INSERT INTO Unidades (id_color, id_linea, id_turno, id_caja, id_lote, estado, fecha_hora, numero_serie) VALUES
(1, 1, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:00:00', 'SN-2026-0024'),
(2, 1, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:05:00', 'SN-2026-0025'),
(3, 1, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:10:00', 'SN-2026-0026'),
(4, 1, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:15:00', 'SN-2026-0027'),
(1, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:20:00', 'SN-2026-0028'),
(2, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:25:00', 'SN-2026-0029'),
(3, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:30:00', 'SN-2026-0030'),
(4, 2, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:35:00', 'SN-2026-0031'),
(1, 3, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:40:00', 'SN-2026-0032'),
(2, 3, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:45:00', 'SN-2026-0033'),
(3, 3, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:50:00', 'SN-2026-0034'),
(4, 3, 1, NULL, 1, 'LIBERADA', '2026-09-23 09:55:00', 'SN-2026-0035');

-- Bloque 5: Producción Turno 2 (SN-2026-0036 a SN-2026-0054)
INSERT INTO Unidades (id_color, id_linea, id_turno, id_caja, id_lote, estado, fecha_hora, numero_serie) VALUES
(1, 1, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:00:00', 'SN-2026-0036'),
(2, 1, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:05:00', 'SN-2026-0037'),
(3, 1, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:10:00', 'SN-2026-0038'),
(4, 1, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:15:00', 'SN-2026-0039'),
(1, 2, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:20:00', 'SN-2026-0040'),
(2, 2, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:25:00', 'SN-2026-0041'),
(3, 2, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:30:00', 'SN-2026-0042'),
(4, 2, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:35:00', 'SN-2026-0043'),
(1, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:40:00', 'SN-2026-0044'),
(2, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:45:00', 'SN-2026-0045'),
(3, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:50:00', 'SN-2026-0046'),
(4, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 15:55:00', 'SN-2026-0047'),
(1, 1, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:00:00', 'SN-2026-0048'),
(2, 1, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:05:00', 'SN-2026-0049'),
(3, 2, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:10:00', 'SN-2026-0050'),
(4, 2, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:15:00', 'SN-2026-0051'),
(1, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:20:00', 'SN-2026-0052'),
(2, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:25:00', 'SN-2026-0053'),
(3, 3, 2, NULL, 1, 'LIBERADA', '2026-09-23 16:30:00', 'SN-2026-0054');


-- 3. PRUEBAS, CALIDAD Y DEFECTOS
INSERT INTO Pruebas (id_unidad, fecha, resultado, detalles_prueba)
SELECT
    id_unidad,
    fecha_hora,
    CASE
        WHEN estado IN ('EMPACADA', 'LIBERADA') THEN 'APROBADO'
        ELSE 'RECHAZADO'
    END,
    CASE
        WHEN estado IN ('EMPACADA', 'LIBERADA') THEN 'Audio, Carga y Bluetooth OK'
        WHEN estado = 'EN_RETENCION' THEN 'Falla en modulo de carga'
        WHEN estado = 'EN_RETRABAJO' THEN 'Estética / Rayón en cubierta'
        ELSE 'Falla fatal de audio / Distorsión'
    END
FROM Unidades;

INSERT INTO Calidad (id_unidad, id_usuario, estado, fecha)
SELECT
    id_unidad,
    3,
    estado,
    fecha_hora
FROM Unidades;

INSERT INTO Defectos (id_calidad, id_categoria, causa)
SELECT
    c.id_calidad,
    CASE
        WHEN u.estado = 'EN_RETENCION' THEN 2
        WHEN u.estado = 'EN_RETRABAJO' THEN 1
        ELSE 2
    END,
    CASE
        WHEN u.estado = 'EN_RETENCION' THEN 'No retiene carga la batería'
        WHEN u.estado = 'EN_RETRABAJO' THEN 'Carcasa mal ensamblada / rayón'
        ELSE 'Bocina no emite sonido / Falla de membrana'
    END
FROM Calidad c
JOIN Unidades u ON c.id_unidad = u.id_unidad
WHERE u.estado IN ('EN_RETENCION', 'EN_RETRABAJO', 'SCRAP');


-- Resincroniza secuencias IDENTITY tras INSERT con identificadores explicitos.
-- Evita que los proximos INSERT automaticos choquen con IDs importados.
DO $$
DECLARE
    col RECORD;
    last_id BIGINT;
    seq_name TEXT;
BEGIN
    FOR col IN
        SELECT table_schema, table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public' AND is_identity = 'YES'
    LOOP
        EXECUTE format('SELECT MAX(%I) FROM %I.%I',
                       col.column_name, col.table_schema, col.table_name)
           INTO last_id;

        seq_name := pg_get_serial_sequence(
            format('%I.%I', col.table_schema, col.table_name),
            col.column_name
        );

        IF seq_name IS NOT NULL THEN
            PERFORM setval(seq_name::regclass,
                           COALESCE(last_id, 1),
                           last_id IS NOT NULL);
        END IF;
    END LOOP;
END
$$;

COMMIT;
