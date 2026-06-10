-- Si la serie nueva llega con is_default=1, degrada la default anterior del mismo
-- hub+año (solo hay UNA serie default por año). No-op si :is_default no es 1.
-- Runtime inyecta :hub_id, :current_user_id, :now.
UPDATE invoice_invoiceseries
SET is_default = 0, updated_by = :current_user_id, updated_at = :now
WHERE hub_id = :hub_id AND year = :year AND is_deleted = 0
  AND is_default = 1 AND COALESCE(:is_default, 0) = 1;
