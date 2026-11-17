-- NOVA SOUND - Migración ADITIVA de Almacén. Ejecutar UNA SOLA VEZ
-- sobre nova_sounds existente; no borra datos de ninguna otra área.
-- IMPORTANTE: al no conocer la orden original de cajas heredadas, queda NULL.
BEGIN;

ALTER TABLE cajas ADD COLUMN IF NOT EXISTS id_orden integer;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS capacidad integer;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS fecha_creacion timestamp without time zone;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS fecha_cierre timestamp without time zone;

ALTER TABLE cajas ALTER COLUMN fecha_creacion SET DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_almacen_cajas_orden' AND conrelid='public.cajas'::regclass) THEN
        ALTER TABLE cajas ADD CONSTRAINT fk_almacen_cajas_orden
            FOREIGN KEY (id_orden) REFERENCES ordenes(id_orden);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_almacen_capacidad' AND conrelid='public.cajas'::regclass) THEN
        ALTER TABLE cajas ADD CONSTRAINT chk_almacen_capacidad
            CHECK (capacidad IS NULL OR capacidad > 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_almacen_cajas_orden ON cajas(id_orden);
CREATE INDEX IF NOT EXISTS ix_almacen_cajas_fecha ON cajas(fecha_creacion);
CREATE INDEX IF NOT EXISTS ix_almacen_cajas_embarque ON cajas(id_embarque);
CREATE INDEX IF NOT EXISTS ix_almacen_unidades_caja ON unidades(id_caja);
CREATE INDEX IF NOT EXISTS ix_almacen_bitacora ON bitacora_general(tabla_afectada, id_registro_afectado, fecha_hora DESC);

COMMIT;
