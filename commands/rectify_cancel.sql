-- Marca la original como cancelada (la inmutabilidad fiscal solo permite rectificar).
--
-- invoice#39: tercera puerta de la cadena, con la MISMA guarda que el bump y el insert (patrón
-- ADR-0020). Sin ella, intentar rectificar algo NO rectificable —una rectificativa, o una factura
-- inexistente— no emitía nada pero sí cancelaba el documento apuntado: un efecto fiscal sin su
-- rectificativa. Ahora solo cancela si de verdad existe una rectificativa viva que la rectifique
-- (la acaba de insertar esta misma transacción, o ya existía de un intento anterior).
UPDATE invoice_invoice
SET status = 'cancelled', updated_by = :current_user_id, updated_at = :now
WHERE id = :original_id AND hub_id = :hub_id AND status != 'cancelled'
  AND EXISTS (
    SELECT 1 FROM invoice_invoice r
    WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = :original_id AND r.is_deleted = 0
  );
