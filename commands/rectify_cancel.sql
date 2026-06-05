-- Marca la original como cancelada (la inmutabilidad fiscal solo permite rectificar).
UPDATE invoice_invoice
SET status = 'cancelled', updated_by = :current_user_id, updated_at = :now
WHERE id = :original_id AND hub_id = :hub_id AND status != 'cancelled';
