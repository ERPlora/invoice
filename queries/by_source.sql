-- Factura generada por un origen (venta/pedido del POS). Runtime inyecta :hub_id.
-- 1 factura por origen (índice único uq_invoice_source); devolvemos la más reciente por robustez.
-- La usa el documento de venta para resolver venta → factura → registro VeriFactu (QR).
SELECT id, invoice_type, series, number, issue_date, issuer_nif, issuer_name,
       customer_tax_id, customer_name, customer_address, total_amount,
       source_type, source_id, status
FROM invoice_invoice
WHERE source_id = :source_id AND hub_id = :hub_id AND is_deleted = 0
ORDER BY created_at DESC
LIMIT 1;
