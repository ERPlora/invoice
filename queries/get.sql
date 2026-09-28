SELECT i.id, i.invoice_type, i.series, i.number, i.issue_date, i.issuer_nif, i.issuer_name,
       i.customer_tax_id, i.customer_name, i.customer_address, i.description,
       i.base_amount, i.tax_amount, i.total_amount, i.tax_breakdown, i.currency,
       i.source_type, i.source_id, i.rectifies_invoice_id, i.status, i.paid_at, i.notes,
       -- invoice#124: the number of the invoice this one rectifies, read inside the same hub, so
       -- the screen composes the translated «Rectifies {number}» without a second read.
       o.number AS rectifies_number
FROM invoice_invoice i
LEFT JOIN invoice_invoice o
  ON o.id = i.rectifies_invoice_id AND o.hub_id = i.hub_id
WHERE i.id = :invoice_id AND i.hub_id = :hub_id AND i.is_deleted = 0;
