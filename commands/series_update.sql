-- PG-compat (auditoría pm#16, 07-17): los binds BOOLEANOS del schema van envueltos en
-- CASE WHEN :x THEN 1 WHEN NOT :x THEN 0 END — las columnas son INTEGER 0/1 por contrato
-- (§2.5) y Postgres NO castea boolean→bigint (SQLite sí lo toleraba). El tri-estado
-- preserva NULL para los COALESCE de opcionales.
-- Edición de los campos mutables de una serie (invoice.manage_series). Update
-- PARCIAL: los params ausentes llegan como NULL y COALESCE conserva el valor actual.
-- `code`, `year` y `current_number` NO son editables (integridad fiscal de la
-- numeración: el número emitido referencia code+year). Runtime inyecta :hub_id,
-- :current_user_id, :now.
UPDATE invoice_invoiceseries
SET name       = COALESCE(:name, name),
    prefix     = COALESCE(:prefix, prefix),
    is_active  = COALESCE(CASE WHEN :is_active THEN 1 WHEN NOT :is_active THEN 0 END, is_active),
    is_default = COALESCE(CASE WHEN :is_default THEN 1 WHEN NOT :is_default THEN 0 END, is_default),
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :series_id AND hub_id = :hub_id AND is_deleted = 0;
