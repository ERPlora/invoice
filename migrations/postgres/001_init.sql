-- Invoice · esquema inicial (Postgres / Aurora cloud). Equivalente a
-- migrations/sqlite/001_init.sql — mismas tablas, índices, FK y contrato de fila del
-- hub (§2.5): hub_id + soft-delete + auditoría. Generado por paridad mecánica.
--
-- Tipos: subconjunto portable "ERPlora SQL" (ADR-0007):
--   * ids/refs → TEXT (UUIDs del runtime como texto);
--   * flags 0/1 → INTEGER (los commands bindean 0/1; Postgres no castea entero→bool);
--   * importes → NUMERIC;
--   * FECHAS → TEXT ISO-8601 (NO TIMESTAMPTZ): el motor de sync (ADR-0031) compara
--     updated_at como string lexicográfico; timestamptz rompería el LWW entre dialectos.

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
    base_amount          INTEGER NOT NULL DEFAULT 0,  -- céntimos (ADR-0007)
    tax_amount           INTEGER NOT NULL DEFAULT 0,  -- céntimos
    total_amount         INTEGER NOT NULL DEFAULT 0,  -- céntimos
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
    quantity     REAL NOT NULL DEFAULT 1,        -- cantidad fraccionable
    unit_price   INTEGER NOT NULL DEFAULT 0,     -- céntimos
    tax_rate     REAL NOT NULL DEFAULT 21,        -- tasa % (no es dinero)
    base_amount  INTEGER NOT NULL DEFAULT 0,     -- céntimos
    tax_amount   INTEGER NOT NULL DEFAULT 0,     -- céntimos
    total_amount INTEGER NOT NULL DEFAULT 0,     -- céntimos
    product_id   TEXT,
    created_at   TEXT,
    FOREIGN KEY (invoice_id) REFERENCES invoice_invoice (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_invoice_item ON invoice_invoiceitem (hub_id, invoice_id);