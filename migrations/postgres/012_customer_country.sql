ALTER TABLE invoice_invoice ADD COLUMN IF NOT EXISTS customer_country TEXT NOT NULL DEFAULT '';
ALTER TABLE invoice_invoice ADD COLUMN IF NOT EXISTS customer_id_type TEXT NOT NULL DEFAULT '';

-- Invoice · 012 — ERPlora/hub#1967: WHERE the customer is from and WHAT their document is.
--
-- (Prose at the end on purpose: a `;` inside a leading `--` block is what splits a migration in the
-- wrong place.)
--
-- An invoice to a customer from outside the EU was declared to the AEAT with the customer as a
-- Spanish NIF: the AEAT does not find it in its census and the record comes back with errors, the
-- chain number already spent. The VeriFactu engine of the hub declares a foreigner with `IDOtro`
-- (country + document kind + number), and it can only do so if the invoice carries both facts.
--
-- - `customer_country`: ISO 3166 alpha-2, upper case ('' = unknown — the engine then reads the tax
--   id's VAT prefix, as before, so every invoice issued before this migration keeps its meaning).
-- - `customer_id_type`: the AEAT `IDType` of the number in `customer_tax_id` — 02 NIF-IVA, 03
--   passport, 04 tax id of the country of residence, 05 residence certificate, 06 other document,
--   07 not registered ('' = let the engine choose by country: 02 in the EU, 04 elsewhere).
--
-- Part of the fiscal SNAPSHOT (ADR-0132): a copy frozen at issue, never re-read from the customer's
-- file. Additive and re-entrant: `ADD COLUMN IF NOT EXISTS` with a default, every existing row
-- reads ''. Reverting is dropping the two columns: nothing else references them, and the hub reads
-- them through `to_jsonb(row)` precisely so that a hub without them keeps working.
--
-- Types: portable "ERPlora SQL" subset (ADR-0007).
