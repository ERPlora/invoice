-- Si la edición marca is_default=1, degrada la default anterior del mismo hub+año
-- (el año se resuelve desde la propia serie editada; solo UNA default por año).
-- No-op si :is_default no es 1. Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE invoice_invoiceseries
SET is_default = 0, updated_by = :current_user_id, updated_at = :now
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_default = 1
  AND id != :series_id
  AND year = (SELECT year FROM invoice_invoiceseries
              WHERE id = :series_id AND hub_id = :hub_id)
  AND COALESCE(:is_default, 0) = 1;
