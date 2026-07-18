-- ADR-0140: enlace de SUSTITUCIÓN. Una factura F3 (factura completa emitida en sustitución de una
-- simplificada F2 ya emitida — "el cliente pide factura de un tiquet") apunta con
-- `substitutes_invoice_id` a la F2 que sustituye. Paralelo a `rectifies_invoice_id` (R1-R5), pero
-- la sustitución NO es rectificación: el tiquet original era correcto, no se anula (inmutable). El
-- estado "sustituida" de la F2 se DERIVA de que exista una F3 apuntándola (no es un campo mutable).
ALTER TABLE invoice_invoice ADD COLUMN substitutes_invoice_id TEXT;
