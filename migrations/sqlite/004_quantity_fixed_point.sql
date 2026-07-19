-- ADR-0147 — `invoice_invoiceitem.quantity` pasa de REAL lógico («2» = 2 uds) a punto fijo
-- ENTERO de escala GLOBAL 10⁶ («2000000» = 2 uds): el mismo lenguaje que ya hablan sales,
-- inventory y kitchen, y el que trae `sale.completed`. EL DINERO NO SE TOCA: unit_price y los
-- importes siguen siendo céntimos enteros (ADR-0123); `tax_rate` sigue REAL (tasa, no dinero).
--
-- VENTANA MIXTA: entre sales v2.8.1 (que ya emite `quantity` escalada) y esta migración,
-- `create_from_sale` guardó el valor escalado TAL CUAL en la columna REAL. Conviven filas
-- lógicas antiguas (1, 2, 0.5…) y filas ya escaladas (500000, 2000000…). Se discrimina por
-- UMBRAL: una cantidad lógica ≥ 100000 en una línea de factura de restaurante/peluquería no
-- existe; todo valor ≥ 100000 se considera ya escalado y no se reescala. (El caso que el umbral
-- clasificaría mal — una venta al peso < 0,1 uds cobrada dentro de la ventana de unas horas —
-- no se da en los datos de QA; documentado en el PR.)
--
-- SQLite: la afinidad REAL fuerza a coma flotante cualquier entero que se le meta (500000 →
-- 500000.0), así que —igual que inventory 006 con su ledger— la única vía es RECONSTRUIR la
-- tabla. Las líneas de factura son inmutables (append-only fiscal): la copia es segura.
ALTER TABLE invoice_invoiceitem RENAME TO invoice_invoiceitem_old;

CREATE TABLE invoice_invoiceitem (
    id           TEXT PRIMARY KEY,
    hub_id       TEXT NOT NULL,
    invoice_id   TEXT NOT NULL,
    line_number  INTEGER NOT NULL DEFAULT 1,
    description  TEXT NOT NULL DEFAULT '',
    quantity     INTEGER NOT NULL DEFAULT 1000000,  -- punto fijo, escala 10⁶ (ADR-0147)
    unit_price   INTEGER NOT NULL DEFAULT 0,        -- céntimos
    tax_rate     REAL NOT NULL DEFAULT 21,          -- tasa % (no es dinero)
    tax_category_key TEXT,                          -- categoría fiscal congelada (ADR-0085, 002)
    base_amount  INTEGER NOT NULL DEFAULT 0,        -- céntimos
    tax_amount   INTEGER NOT NULL DEFAULT 0,        -- céntimos
    total_amount INTEGER NOT NULL DEFAULT 0,        -- céntimos
    product_id   TEXT,
    created_at   TEXT,
    FOREIGN KEY (invoice_id) REFERENCES invoice_invoice (id) ON DELETE CASCADE
);

INSERT INTO invoice_invoiceitem
    (id, hub_id, invoice_id, line_number, description, quantity, unit_price, tax_rate,
     tax_category_key, base_amount, tax_amount, total_amount, product_id, created_at)
SELECT id, hub_id, invoice_id, line_number, description,
       CASE WHEN quantity >= 100000 THEN CAST(ROUND(quantity) AS INTEGER)
            ELSE CAST(ROUND(quantity * 1000000) AS INTEGER) END,
       unit_price, tax_rate, tax_category_key, base_amount, tax_amount, total_amount,
       product_id, created_at
FROM invoice_invoiceitem_old;

DROP TABLE invoice_invoiceitem_old;

CREATE INDEX IF NOT EXISTS ix_invoice_item ON invoice_invoiceitem (hub_id, invoice_id);
