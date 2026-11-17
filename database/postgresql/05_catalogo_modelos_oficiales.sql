-- NOVA SOUND v1.0 - catalogo oficial de modelos.
-- APLICAR SOLO DESPUES DE RESPALDO Y REVISION POR EL EQUIPO.
-- No borra unidades, ordenes, cajas ni historicos; conserva IDs.
-- Su unico cambio de nombre es en el registro DEMO 'Modelo SoundPro X'.
-- Re-ejecutable de forma idempotente si no hay modelos duplicados o desconocidos.
BEGIN;

DO $$
DECLARE
    antiguos integer;
    mini integer;
BEGIN
    SELECT count(*) INTO antiguos FROM modelos WHERE nombre = 'Modelo SoundPro X';
    SELECT count(*) INTO mini FROM modelos WHERE nombre = 'NS-MINI';

    IF antiguos > 1 THEN
        RAISE EXCEPTION 'Hay mas de un Modelo SoundPro X; revisar antes de continuar';
    END IF;
    IF antiguos = 1 AND mini > 0 THEN
        RAISE EXCEPTION 'Existen SoundPro X y NS-MINI: requiere conciliacion manual para preservar relaciones';
    END IF;

    IF antiguos = 1 THEN
        UPDATE modelos SET nombre = 'NS-MINI' WHERE nombre = 'Modelo SoundPro X';
    END IF;

    INSERT INTO modelos(nombre)
    SELECT oficial.nombre
    FROM (VALUES ('NS-MINI'), ('NS-SPORT'), ('NS-PRO'), ('NS-MAX')) AS oficial(nombre)
    WHERE NOT EXISTS (SELECT 1 FROM modelos m WHERE m.nombre = oficial.nombre);

    IF EXISTS (
        SELECT nombre FROM modelos
        GROUP BY nombre HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Hay nombres de modelos duplicados: revisar catalogo';
    END IF;
    IF EXISTS (SELECT 1 FROM modelos
               WHERE nombre NOT IN ('NS-MINI','NS-SPORT','NS-PRO','NS-MAX')) THEN
        RAISE EXCEPTION 'Existen otros modelos diferentes a los cuatro oficiales; no se eliminan automaticamente';
    END IF;
END $$;

-- IDs definidos explicitamente por el seed anterior: actualizar secuencia sin colisiones.
SELECT setval(pg_get_serial_sequence('modelos','id_modelo'),
              COALESCE((SELECT MAX(id_modelo) FROM modelos), 1),
              EXISTS (SELECT 1 FROM modelos));
COMMIT;

-- Comprobacion de solo lectura:
-- SELECT id_modelo, nombre FROM modelos ORDER BY id_modelo;
