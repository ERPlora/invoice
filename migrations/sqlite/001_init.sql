-- Invoice · esquema inicial (SQLite). Portado fielmente de old_modules/m_invoice/models.py (v1.0.6).
-- Modelos: InvoiceSeries (numeración por code+year), Invoice (F1/F2/F3/R1-R5), InvoiceItem (líneas).
-- Entidad fiscal: inmutable tras emitir (RD 1007/2023); corrección solo vía rectificación.
-- Contrato de fila §2.5: hub_id + soft-delete + auditoría.

CREATE TABLE IF NOT EXISTS invoice_invoiceseries (
    id             TEXT PRIMARY KEY,
    hub_id         TEXT NOT NULL,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL DEFAULT '',
    invoice_type   TEXT NOT NULL,              -- F1|F2|F3|R1..R5
    year           INTEGER NOT NULL,
    current_number INTEGER NOT NULL DEFAULT 0, -- monotónico, += 1 por emisión
    prefix         TEXT NOT NULL DEFAULT '',
    is_active      INTEGER NOT NULL DEFAULT 1,
    is_default     INTEGER NOT NULL DEFAULT 0,
    is_deleted     INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
    created_by TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_series ON invoice_invoiceseries (hub_id, code, year);

CREATE TABLE IF NOT EXISTS invoice_invoice (
    id                   TEXT PRIMARY KEY,
    hub_id               TEXT NOT NULL,
    invoice_type         TEXT NOT NULL DEFAULT 'F2',
    series               TEXT NOT NULL,
    number               TEXT NOT NULL,        -- formateado: PREFIX-YYYY-000001
    issue_date           TEXT NOT NULL,
    issuer_nif           TEXT NOT NULL DEFAULT '',
    issuer_name          TEXT NOT NULL DEFAULT '',
    customer_tax_id      TEXT NOT NULL DEFAULT '',
    customer_name        TEXT NOT NULL DEFAULT '',
    customer_address     TEXT NOT NULL DEFAULT '',
    description          TEXT NOT NULL DEFAULT '',
    base_amount          NUMERIC NOT NULL DEFAULT 0,
    tax_amount           NUMERIC NOT NULL DEFAULT 0,
    total_amount         NUMERIC NOT NULL DEFAULT 0,
    tax_breakdown        TEXT NOT NULL DEFAULT '{}',
    currency             TEXT NOT NULL DEFAULT 'EUR',
    source_type          TEXT NOT NULL DEFAULT 'manual',  -- sale|pos|order|manual
    source_id            TEXT,                            -- idempotencia (1 factura por venta)
    rectifies_invoice_id TEXT,                            -- R1..R5 → factura original
    status               TEXT NOT NULL DEFAULT 'issued',  -- draft|issued|paid|cancelled
    paid_at              TEXT,
    notes                TEXT NOT NULL DEFAULT '',
    is_deleted           INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
    created_by TEXT, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_series_number ON invoice_invoice (hub_id, series, number);
CREATE INDEX IF NOT EXISTS ix_invoice_hub_issue_date ON invoice_invoice (hub_id, issue_date);
CREATE INDEX IF NOT EXISTS ix_invoice_hub_source     ON invoice_invoice (hub_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_invoice_hub_status     ON invoice_invoice (hub_id, status);

CREATE TABLE IF NOT EXISTS invoice_invoiceitem (
    id           TEXT PRIMARY KEY,
    hub_id       TEXT NOT NULL,
    invoice_id   TEXT NOT NULL,
    line_number  INTEGER NOT NULL DEFAULT 1,
    description  TEXT NOT NULL DEFAULT '',
    quantity     NUMERIC NOT NULL DEFAULT 1,
    unit_price   NUMERIC NOT NULL DEFAULT 0,
    tax_rate     NUMERIC NOT NULL DEFAULT 21,
    base_amount  NUMERIC NOT NULL DEFAULT 0,
    tax_amount   NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    product_id   TEXT,
    created_at   TEXT,
    FOREIGN KEY (invoice_id) REFERENCES invoice_invoice (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_invoice_item ON invoice_invoiceitem (hub_id, invoice_id);
