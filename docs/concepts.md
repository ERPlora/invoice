# Invoicing — Concepts

The things people get wrong on their first day.

## An issued invoice is immutable

**You cannot edit an invoice. You cannot delete an invoice.** There is no command for either, and
that is not an oversight — it is what the law requires of billing software (RD 1007/2023).

Everything you might want to do to a wrong invoice is done by **issuing another document**:

| The problem | What you issue |
|---|---|
| The invoice is wrong (amount, customer, anything) | A **rectifying** invoice (R1) |
| The invoice is right, but the customer needs a full one instead of the ticket | A **substituting** invoice (F3) |
| The customer has not paid yet | Nothing — you mark it paid when they do |

## Rectify versus substitute — the distinction that matters

This is the single most common confusion.

**Rectify (R1)** — *the document was wrong, or part of the money came back.*
The module issues a new invoice in the `RECT` series with **the amounts negated**, copying the issuer
and customer from the original. Rectified by hand (`invoice.rectify`) it negates the **whole**
original and marks it **cancelled**: two documents now exist and they cancel out. Needs
`invoice.rectify_invoice`.

A **refund** does this on its own (`sale.refunded` → `invoice._rectify_from_refund`), and it
rectifies **the money returned**, not the document: a partial refund issues a rectifying invoice *por
diferencias* for that amount, with the original's tax breakdown **prorated** (Σ of the breakdown is
exactly the amount returned, each quota still `base × rate` to the cent) and a single line, the
refund; the original **stays issued** and the two coexist. The act that closes the return rectifies
**what is left** — never its own amount — so the rectifications add up to the original to the cent,
and only then is the original cancelled. One invoice therefore carries **one rectification per
refund document**, and the same refund delivered twice is still one document.

**Substitute (F3)** — *the document was right, but incomplete for the customer.*
Someone paid, got a ticket (F2), and now needs a proper invoice with their tax id. The module issues
an F3 in the `FACT` series that **links to** the F2 and reuses its lines and amounts unchanged. The
**F2 is not cancelled and not touched** — nothing was wrong with it. Needs `invoice.add_invoice`.

Using a rectification for the second case would be wrong: it would declare that a correct sale never
happened.

Note that "this F2 has been substituted" is **derived** from an F3 pointing at it, not a field
someone flips. And there can be **only one F3 per F2**.

## Voiding a sale is not rectifying its invoice

`sales.void` cancels the sale — stock comes back, the till is corrected. It does **not** issue a
rectifying invoice. If that sale had already produced an invoice, the fiscal correction is a separate
act and it happens here.

## Numbering: one counter per series and year, only going up

An invoice number is `PREFIX-YYYY-NNNNNN` by default, or whatever **template** the series carries
(`{prefix}`, `{code}`, `{year}`, `{seq}`, `{seq:01d}`…`{seq:09d}` — see *Screens*). The number comes
from the series counter, incremented in the same transaction that writes the invoice, so two
documents can never share a number. The next one can be previewed without consuming it.

Consequences worth knowing:

- **You cannot edit a series' code, year or current number.** The numbering is the fiscal identity of
  the series; letting someone rewind a counter would create duplicates or gaps.
- **A new year starts a new counter automatically.** The series row for `code + year` is ensured on
  first use.
- **There is exactly one default series per year.** Marking one default demotes the previous one.
- **The number format freezes with the first invoice.** It is part of VeriFactu's chained
  fingerprint; a different shape means a new series, never a re-shaped one.

## The numbering book: every number handed out is written down

Since ADR-0369 this module is the hub's **only** fiscal sequencer, and every number it hands out is
recorded in an **append-only book** — one row per number, with the series, the year, the sequence,
the rendered number and the invoice behind it. The row is written **in the same transaction** as the
counter bump and the invoice itself, so the book can never disagree with what was issued.

It exists for the "no gaps, no duplicates" audit the law asks for. Two questions it answers:

- **`invoice.numbering.allocations`** — the book itself: what number went to which invoice, and when.
- **`invoice.numbering.gaps`** — the holes. **No rows means the numbering is correlative**, which is
  the thing you actually have to be able to prove.

Two things worth knowing. The book **starts the day the module is updated to the version that
introduced it**: invoices numbered before that have no row, and nothing is back-filled — deriving an
audit trail after the fact would be inventing evidence. And a row whose invoice is empty means a
number was consumed without a document behind it; it is written down precisely so the gap is
*explained* instead of merely visible.

## One invoice per source, always

Every automatically-created invoice records where it came from — a sale, an order, a substitution —
and that origin is what makes the operation idempotent. If the same `sale.completed` is delivered
twice, you still get **one** invoice. If a substitution is retried, you still get **one** F3.

## The invoice reuses the sale's numbers; it does not recompute them

When an invoice is created from a sale, the base, the tax and the totals come **from the sale**. The
sale already resolved the rate server-side and froze it on the line, so recalculating here could only
introduce a disagreement between what was charged and what is declared.

A caveat worth knowing: the sale freezes **five** fiscal fields on each line (category, rate,
country, region and rule), but only **two** of them — the rate and the category — travel in the
event. So an invoice line stores the rate and the category, not the country, region or rule id.

A **manual** invoice is different: nobody has charged anything yet, so the module computes the tax
itself. When the line carries a tax category that resolves to a rule, **the rule's rate is what is
charged** (including any equivalence surcharge component) — the `tax_rate` sent by the caller is
only used when there is no rule to consult. Charging one thing and declaring another is exactly the
mismatch the tax authority cross-checks (the total quota must equal the sum of the declared quotas),
so both come from the same resolution.

## Every sale currently becomes an F2

The sale decides whether it is a ticket or a full invoice, but that choice does **not travel in the
event**, so today an invoice created from a sale is always a simplified **F2** in the `TICKET`
series — even when the sale was marked as a full invoice. Getting an F1 out of it means issuing the
substitution afterwards.

## The tax breakdown has two axes, not one

An older breakdown grouped only by rate. The current one groups by the **fiscal facts** of the
operation: which tax, which regime, whether it is subject, exempt or not subject, the exemption
reason, the rate, the base and the quota — plus any surcharge.

That is because a rate alone cannot be declared. Two lines at 0 % may be 0 % for completely different
legal reasons, and the tax authority needs to know which.

The fiscal record sent to the authority is built from this list **verbatim**. Invoices issued before
this change keep the old rate-keyed shape and are still read correctly.

## The line stores the rate and the surcharge apart

Under the equivalence surcharge the sale charges a combined 26.2 % (21 % VAT + 5.2 % surcharge).
That is a sum, not a tax rate, so an invoice line freezes them **separately**: `tax_rate` is the main
rate and `surcharge_rate` the surcharge (0 when there is none). The breakdown and the lines now say
the same thing.

Lines issued before this change are not rewritten (a fiscal row is frozen): they have no
`surcharge_rate` at all, and their `tax_rate` may still be that combined sum. Readers tell the two
generations apart by that absence and show the old ones exactly as they were frozen.

## Status is a small, one-way ladder

`draft` → `issued` → `paid`, or `issued` → `cancelled` when a rectification cancels it.

- Only an `issued` invoice can be marked paid.
- Marking paid records **the date only** — no amount changes and no payment method is stored. If you
  need to know how it was paid, that lives with the sale.
- `cancelled` is reached by being rectified, not by a delete.

## Every amount is an integer number of cents

Base, tax, total, unit prices and line amounts are **cents** (ADR-0123). `1250` is 12,50 €. The
currency is EUR.
