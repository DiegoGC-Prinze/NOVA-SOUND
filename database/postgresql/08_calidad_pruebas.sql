-- Calidad y Pruebas funcionales: preserva históricos y permisos editados.
BEGIN;
ALTER TABLE pruebas ADD COLUMN IF NOT EXISTS resultados JSONB;
ALTER TABLE pruebas ADD COLUMN IF NOT EXISTS observaciones TEXT NOT NULL DEFAULT '';
ALTER TABLE pruebas ADD COLUMN IF NOT EXISTS id_usuario INT REFERENCES usuarios(id_usuario);
ALTER TABLE calidad ADD COLUMN IF NOT EXISTS observaciones TEXT NOT NULL DEFAULT '';
ALTER TABLE calidad ADD COLUMN IF NOT EXISTS evento VARCHAR(30) NOT NULL DEFAULT 'INSPECCION';
ALTER TABLE defectos ADD COLUMN IF NOT EXISTS nombre VARCHAR(100);
ALTER TABLE retrabajo ADD COLUMN IF NOT EXISTS observaciones TEXT NOT NULL DEFAULT '';
ALTER TABLE retrabajo ADD COLUMN IF NOT EXISTS id_usuario INT REFERENCES usuarios(id_usuario);
ALTER TABLE retrabajo ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMP;
CREATE INDEX IF NOT EXISTS ix_pruebas_unidad_reciente ON pruebas(id_unidad,fecha DESC,id_prueba DESC);
CREATE INDEX IF NOT EXISTS ix_calidad_unidad_reciente ON calidad(id_unidad,fecha DESC,id_calidad DESC);
CREATE INDEX IF NOT EXISTS ix_retrabajo_unidad_reciente ON retrabajo(id_unidad,id_retrabajo DESC);
-- Definiciones iniciales de defectos del catálogo del proyecto, sin crear inspecciones.
INSERT INTO catalogos_web(tipo,codigo,nombre)
 SELECT 'defectos',c.codigo||d.sufijo,d.nombre
 FROM catalogos_web c CROSS JOIN (VALUES
  ('Apariencia','-01','Rayón'),('Apariencia','-02','Golpe'),
  ('Apariencia','-03','Carcasa mal cerrada'),('Apariencia','-04','Color incorrecto'),
  ('Funcional','-01','No enciende'),('Funcional','-02','No carga'),
  ('Funcional','-03','Falla Bluetooth'),('Funcional','-04','Distorsión de audio')
 ) AS d(categoria,sufijo,nombre)
 WHERE c.tipo='categorias' AND lower(c.nombre) LIKE '%'||lower(d.categoria)||'%'
 AND NOT EXISTS(SELECT 1 FROM configuracion_web WHERE clave='integracion-calidad-v1')
 ON CONFLICT DO NOTHING;
-- Las políticas iniciales de las áreas nuevas se agregan abajo una sola vez.

DO $politicas$
BEGIN
IF NOT EXISTS(SELECT 1 FROM configuracion_web WHERE clave='integracion-calidad-v1') THEN
UPDATE roles SET permisos='{"prueba-funcional/escanear-pieza-o-lote": "acciona", "prueba-funcional/registro-de-pruebas-funcionales": "acciona", "prueba-funcional/unidades-por-probar": "acciona", "prueba-funcional/historial-de-pruebas": "ver"}'::jsonb || COALESCE(permisos,'{}'::jsonb),acciones=(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(roles.acciones,'[]'::jsonb)||'["registrar-resultado-de-prueba-funcional"]'::jsonb)) WHERE nombre='Operador';
UPDATE roles SET permisos='{"prueba-funcional/unidades-por-probar": "ver", "prueba-funcional/historial-de-pruebas": "ver"}'::jsonb || COALESCE(permisos,'{}'::jsonb),acciones=(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(roles.acciones,'[]'::jsonb)||'[]'::jsonb)) WHERE nombre='Líder de línea';
UPDATE roles SET permisos='{"prueba-funcional/historial-de-pruebas": "ver", "calidad/resumen-de-calidad": "acciona", "calidad/inspeccion-de-unidad": "acciona", "calidad/retenciones": "acciona", "calidad/retrabajos": "acciona", "calidad/historial-de-la-unidad": "ver", "calidad/reportes-de-calidad": "acciona"}'::jsonb || COALESCE(permisos,'{}'::jsonb),acciones=(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(roles.acciones,'[]'::jsonb)||'["dar-disposicion-de-calidad-liberar-retener-retrabajo-scrap"]'::jsonb)) WHERE nombre='Inspector de Calidad';
UPDATE roles SET permisos='{"prueba-funcional/historial-de-pruebas": "ver", "calidad/resumen-de-calidad": "acciona", "calidad/inspeccion-de-unidad": "acciona", "calidad/retenciones": "acciona", "calidad/retrabajos": "acciona", "calidad/historial-de-la-unidad": "ver", "calidad/reportes-de-calidad": "acciona"}'::jsonb || COALESCE(permisos,'{}'::jsonb),acciones=(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(roles.acciones,'[]'::jsonb)||'["dar-disposicion-de-calidad-liberar-retener-retrabajo-scrap"]'::jsonb)) WHERE nombre='Inspector Calidad';
UPDATE roles SET permisos='{"prueba-funcional/escanear-pieza-o-lote": "acciona", "prueba-funcional/registro-de-pruebas-funcionales": "acciona", "prueba-funcional/unidades-por-probar": "acciona", "prueba-funcional/historial-de-pruebas": "acciona", "calidad/resumen-de-calidad": "acciona", "calidad/inspeccion-de-unidad": "acciona", "calidad/retenciones": "acciona", "calidad/retrabajos": "acciona", "calidad/historial-de-la-unidad": "acciona", "calidad/reportes-de-calidad": "acciona"}'::jsonb || COALESCE(permisos,'{}'::jsonb),acciones=(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(roles.acciones,'[]'::jsonb)||'["registrar-resultado-de-prueba-funcional", "dar-disposicion-de-calidad-liberar-retener-retrabajo-scrap"]'::jsonb)) WHERE nombre='Administrador';
INSERT INTO configuracion_web(clave,valor,motivo) VALUES ('integracion-calidad-v1','true','Activacion inicial de Calidad y Pruebas funcionales');
END IF;
END $politicas$;
COMMIT;
