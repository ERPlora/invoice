# Invoicing — Overview

## What this module does

Invoicing turns completed sales into **numbered fiscal documents**. It issues invoices, keeps their
numbering series monotonic per year, marks them paid, and issues the two kinds of follow-up document
the law recognises: a **rectifying** invoice when something was wrong, and a **substituting** invoice
when a customer asks for a full invoice for a ticket they already have.

Its central rule is **fiscal immutability**: an issued invoice is never modified and never deleted.
Everything else in the module follows from that.

## What this module does NOT do

- **It does not edit or delete invoices.** There is no such command, on purpose (RD 1007/2023).
- **It does not report anything to the tax authority.** It emits `invoice.created`; `verifactu`
  builds and sends the fiscal record.
- **It does not compute tax rates.** It reuses the amounts and the rate the sale already froze, and
  reads the rule catalogue only to qualify the breakdown.
- **It does not record how something was paid.** Marking an invoice paid stores the date, not a
  payment method.
- **It does not print or email documents.** That belongs to `printing` and to the sale document view.
- **It does not manage receivables, ageing or dunning.**

## Modules it connects to

**Depends on `taxes` and `sales`** — installing Invoicing installs both automatically. It needs
`sales` for the event that creates invoices and `taxes` for the rule catalogue that qualifies each
line of the breakdown.

**Events it emits**

| Event | When |
|---|---|
| `invoice.created` | an invoice is issued — manually, from a sale, or as a substitution |
| `invoice.rectified` | a rectifying invoice is issued |

**Events it listens to**

| Event | Runs | Effect |
|---|---|---|
| `sale.completed` (from `sales`) | `invoice.create_from_sale` | Issues a simplified invoice (F2) in the `TICKET` series for that sale |

So in the normal flow **you never create an invoice by hand**: selling produces one.

## The document types

| Type | What it is |
|---|---|
| **F1** | Full invoice, with the customer's tax details |
| **F2** | Simplified invoice — the ticket. What a sale produces by default |
| **F3** | Full invoice that **substitutes** an already-issued F2 |
| **R1–R5** | Rectifying invoices. The module issues **R1** |

## Where its numbers come from

- **All amounts are integer cents** (ADR-0123): base, tax, total and every line.
- **Invoice numbers** are `PREFIX-YYYY-NNNNNN`, taken from a per-series, per-year counter that only
  ever goes up.
- **The tax breakdown** is stored as a list of entries keyed by the fiscal facts of the operation —
  the tax, the regime, whether it is subject or exempt, the exemption reason, the rate, the base and
  the quota. That list is what the fiscal record is built from, verbatim.
