-- Edición de los campos mutables de una serie (invoice.manage_series). Update
-- PARCIAL: los params ausentes llegan como NULL y COALESCE conserva el valor actual.
-- `code`, `year` y `current_number` NO son editables (integridad fiscal de la
-- numeración: el número emitido referencia code+year). Runtime inyecta :hub_id,
-- :current_user_id, :now.
UPDATE invoice_invoiceseries
SET name       = COALESCE(:name, name),
    prefix     = COALESCE(:prefix, prefix),
    is_active  = COALESCE(:is_active, is_active),
    is_default = COALESCE(:is_default, is_default),
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :series_id AND hub_id = :hub_id AND is_deleted = 0;
