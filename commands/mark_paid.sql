-- Marca una factura como pagada. No altera importes (inmutabilidad fiscal).
UPDATE invoice_invoice
SET status = 'paid', paid_at = :now, updated_by = :current_user_id, updated_at = :now
WHERE id = :invoice_id AND hub_id = :hub_id AND status IN ('issued');
