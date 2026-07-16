-- PG-compat (auditoría pm#16, 07-17): los binds BOOLEANOS del schema van envueltos en
-- CASE WHEN :x THEN 1 WHEN NOT :x THEN 0 END — las columnas son INTEGER 0/1 por contrato
-- (§2.5) y Postgres NO castea boolean→bigint (SQLite sí lo toleraba). El tri-estado
-- preserva NULL para los COALESCE de opcionales.
-- Si la serie nueva llega con is_default=1, degrada la default anterior del mismo
-- hub+año (solo hay UNA serie default por año). No-op si CASE WHEN :is_default THEN 1 WHEN NOT :is_default THEN 0 END no es 1.
-- Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE invoice_invoiceseries
SET is_default = 0, updated_by = :current_user_id, updated_at = :now
WHERE hub_id = :hub_id AND year = :year AND is_deleted = 0
  AND is_default = 1 AND COALESCE(CASE WHEN :is_default THEN 1 WHEN NOT :is_default THEN 0 END, 0) = 1;
