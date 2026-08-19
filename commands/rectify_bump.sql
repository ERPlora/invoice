-- Incrementa el contador de la serie RECT (monotónico). Runtime inyecta :hub_id; :year/:original_id
-- vienen del payload.
--
-- invoice#39: ESTE UPDATE NO TENÍA GUARDA. `_bump_series` sí la tiene, así que las dos puertas de la
-- numeración se comportaban distinto: aquí un reintento de `invoice.rectify` sobre la misma factura
-- consumía un número Y emitía una SEGUNDA rectificativa. `uq_invoice_series_number` no puede verlo
-- —el segundo número es OTRO número—, así que no había nada que lo parase.
--
-- La guarda es EXACTAMENTE la precondición de `rectify_insert.sql` (patrón ADR-0020: la misma
-- condición en todas las puertas de la cadena). Si el insert va a ser no-op, aquí no se gasta número:
--   * la original existe, es de este hub, está viva y NO es ya una rectificativa (no se rectifica
--     una rectificativa: la cadena fiscal se sigue por `rectifies_invoice_id`);
--   * y no hay ya una rectificativa viva apuntándola (idempotencia: 1 rectificativa por factura).
UPDATE invoice_invoiceseries
SET current_number = current_number + 1
WHERE hub_id = :hub_id AND code = 'RECT' AND year = :year
  AND EXISTS (
    SELECT 1 FROM invoice_invoice o
    WHERE o.id = :original_id AND o.hub_id = :hub_id
      AND o.invoice_type NOT LIKE 'R%' AND o.is_deleted = 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice r
    WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = :original_id AND r.is_deleted = 0
  );
