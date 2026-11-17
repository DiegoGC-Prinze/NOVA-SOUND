-- Integracion de Empaque/Embarques: sesiones revocables y datos del formulario.
-- Migracion aditiva y reejecutable; conserva usuarios, cajas y movimientos.
BEGIN;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS destino varchar(200);
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS contenedor varchar(100);
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS fecha_creacion timestamp without time zone;
ALTER TABLE embarques ALTER COLUMN fecha_creacion SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS sesiones_web (
    token_hash char(64) PRIMARY KEY,
    id_usuario integer NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_expiracion timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sesiones_web_usuario ON sesiones_web(id_usuario);
CREATE INDEX IF NOT EXISTS ix_sesiones_web_expiracion ON sesiones_web(fecha_expiracion);

INSERT INTO roles(nombre)
SELECT nombre FROM (VALUES ('Almacén/Empaque'), ('Supervisor de almacén')) AS nuevos(nombre)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE lower(r.nombre)=lower(nuevos.nombre));
COMMIT;
