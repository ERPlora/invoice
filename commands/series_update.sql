-- Edición de los campos mutables de una serie (invoice.manage_series). Update
-- PARCIAL: los params ausentes llegan como NULL y COALESCE conserva el valor actual.
-- `code`, `year` y `current_number` NO son editables (integridad fiscal de la
-- numeración: el número emitido referencia code+year). Runtime inyecta :hub_id,
-- :current_user_id, :now.
--
-- 🔴 `format` (invoice#40) es editable SOLO mientras la serie no ha emitido nada
-- (`current_number = 0`). Después queda congelado: el número entra en la huella encadenada de
-- VeriFactu (`hub/crates/verifactu/src/chain.rs` → `NumSerieFactura`), así que cambiar la forma de
-- una serie viva rompe la continuidad de todo lo emitido después — y dejaría dos formas conviviendo
-- dentro de la misma serie. Se ignora en silencio, exactamente como `code`/`year`/`current_number`,
-- que ni siquiera aparecen aquí: es el trato que este módulo ya le da a la identidad fiscal de la
-- numeración, y la pantalla de Ajustes no ofrece el campo (`format_locked` en
-- `queries/series_peek_next.sql` y en `queries/series_list.sql`).
UPDATE invoice_invoiceseries
SET name       = COALESCE(:name, name),
    prefix     = COALESCE(:prefix, prefix),
    format     = CASE WHEN current_number = 0 THEN COALESCE(:format, format) ELSE format END,
    is_active  = COALESCE(:is_active, is_active),
    is_default = COALESCE(:is_default, is_default),
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :series_id AND hub_id = :hub_id AND is_deleted = 0;
