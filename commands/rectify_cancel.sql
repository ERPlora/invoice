-- Marca la original como cancelada (la inmutabilidad fiscal solo permite rectificar).
--
-- invoice#39: tercera puerta de la cadena, con la MISMA guarda que el bump y el insert (patrón
-- ADR-0020). Sin ella, intentar rectificar algo NO rectificable —una rectificativa, o una factura
-- inexistente— no emitía nada pero sí cancelaba el documento apuntado: un efecto fiscal sin su
-- rectificativa. Ahora solo cancela si de verdad existe una rectificativa viva que la rectifique
-- (la acaba de insertar esta misma transacción, o ya existía de un intento anterior).
--
-- invoice#62: la MISMA resolución de original que las otras dos puertas — por `:original_id` cuando
-- lo nombra una persona, por la venta cuando lo entrega el relay de `sale.refunded`. Y la cancela
-- solo si de verdad hay una rectificativa viva **apuntando a ESA fila** (`invoice_invoice.id`, no al
-- parámetro, que en el camino de la devolución es NULL). Sin eso, resolver por venta y comprobar por
-- parámetro habría cancelado el ticket sin que nada lo rectificara.
UPDATE invoice_invoice
SET status = 'cancelled', updated_by = :current_user_id, updated_at = :now
WHERE hub_id = :hub_id AND status != 'cancelled'
  AND is_deleted = 0 AND invoice_type NOT LIKE 'R%'
  AND (id = CAST(:original_id AS TEXT)
       OR (CAST(:original_id AS TEXT) IS NULL
           AND source_type = 'sale'
           AND source_id = CAST(:sale_id AS TEXT)))
  AND EXISTS (
    SELECT 1 FROM invoice_invoice r
    WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = invoice_invoice.id AND r.is_deleted = 0
  );
