-- Marca la original como cancelada (la inmutabilidad fiscal solo permite rectificar).
--
-- invoice#39: tercera puerta de la cadena, con la MISMA guarda que el bump y el insert (patrón
-- ADR-0020). Sin ella, intentar rectificar algo NO rectificable —una rectificativa, o una factura
-- inexistente— no emitía nada pero sí cancelaba el documento apuntado: un efecto fiscal sin su
-- rectificativa.
--
-- invoice#62: la MISMA resolución de original que las otras puertas — por `:original_id` cuando lo
-- nombra una persona, por la venta cuando lo entrega el relay de `sale.refunded`.
--
-- invoice#63: se cancela SOLO cuando no queda nada en pie — cuando la suma de las rectificativas
-- vivas que la apuntan es exactamente su total. Una rectificativa por diferencias deja el original
-- emitido y conviven (eso es «por diferencias»); el acto que cierra la devolución, o una
-- rectificación entera, lo dejan a cero y entonces sí se marca. La condición sirve a las dos
-- puertas: la manual niega el total de una vez y cumple la igualdad en el mismo acto.
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
  )
  AND invoice_invoice.total_amount + (
    SELECT COALESCE(SUM(r.total_amount), 0) FROM invoice_invoice r
    WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = invoice_invoice.id AND r.is_deleted = 0
  ) = 0;
