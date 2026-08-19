# Invoicing — Screens

The module contributes two tabs to the hub navigation: **Invoices** and **Settings**.

## Invoices

The list of issued invoices (`invoice.list`, 50 rows per page). Requires `invoice.view_invoice`.

- **Search** by number, customer name or customer tax id.
- **Sort** by type, series, number, issue date, customer, customer tax id, base, tax, total, status
  or source.
- **Filter** by type, series, number, issue date range, customer name, customer tax id, amount
  ranges, status or source type.

Open a row to see the full document: header, lines and totals (`invoice.get` + `invoice.lines`, lines
ordered by line number). Actions appear according to your permissions, and the server re-checks them.

### Issue an invoice by hand

Most invoices are created by selling. Use this when you need one that did not come from a sale.

1. Open **Invoices** and start a new invoice.
2. Add the **lines**: description, quantity, unit price, tax rate, and optionally the product. At
   least one line is required.
3. Fill in the issuer and the customer details if they are not defaulted.
4. Pick the **series**; leaving it empty uses `FACT` and type F1.
5. Save.

The module computes each line's base, tax and total, builds the tax breakdown, takes the next number
from the series and emits `invoice.created`. Requires `invoice.add_invoice`.

### Mark an invoice as paid

1. Open an invoice whose status is **issued**.
2. Choose **mark as paid**.

The status becomes `paid` and the payment date is recorded. **No amount changes and no payment method
is stored.** Only an `issued` invoice can be marked paid — not a draft, not a cancelled one, not one
already paid. Requires `invoice.add_invoice`.

### Rectify an invoice (something was wrong)

1. Open the invoice. The action is available only on invoices that are **not** themselves rectifying
   and **not** cancelled.
2. Choose **rectify** and give the reason.
3. Confirm.

What happens, in one transaction: the `RECT` series for this year is ensured, its counter is bumped,
a new **R1** invoice is written with **the amounts negated** and the issuer and customer copied from
the original, and the original is marked `cancelled`. `invoice.rectified` is emitted.

The original invoice itself is **not modified** — only its status moves to cancelled. Requires
`invoice.rectify_invoice`.

### Issue a full invoice for a ticket (substitution)

This is the "the customer asks for an invoice for their ticket" case. The ticket was correct; the
customer simply needs a document with their tax details.

1. Take the already-issued **F2** and its lines.
2. Issue a **substituting F3** with the customer's tax id, name and optionally address.
3. The F3 goes out in the `FACT` series, linked to the F2, reusing the ticket's lines and amounts
   **without recalculating them**.

The F2 is never touched. Only **one F3 per F2** can exist.

> This command exists and works, but the Invoices screen does not offer a button for it yet — the
> "ask for an invoice for this ticket" action is still missing from the UI.

Requires `invoice.add_invoice`.

## Settings — numbering series

The Settings tab manages the invoice series (`invoice.series.list`, 50 rows per page). Viewing needs
`invoice.view_invoice`; changing anything needs `invoice.manage_series`.

- **Search** by code, name or current number.
- **Sort** by code, name, type, year, current number, prefix, active or default flag. Default: name,
  ascending.
- **Filter** by any of those.

### Create a series

1. Give it a **code**, an **invoice type** (F1, F2, F3, R1–R5) and a **year**. Those three are
   required.
2. Optionally a display name, a **prefix** for the number, and whether it is active or the default.
3. Save. The counter starts at zero.

Marking a series as default **demotes the previous default of the same year** — there is only ever
one default per year. Codes are unique per hub and year.

### Change a series

Only `name`, `prefix`, `is_active` and `is_default` can be edited, and the edit is partial — fields
you leave out are untouched.

**`code`, `year` and the current number cannot be changed.** They are the identity of the numbering
and changing them would break the fiscal sequence.

## The series you get by default

| Series | Used for |
|---|---|
| `TICKET` | F2 simplified invoices, created automatically from every sale |
| `FACT` | F1 full invoices, and the F3 substitutions (they share the numbering) |
| `RECT` | R1 rectifying invoices |

Each is ensured on first use for the year, so a new year starts a fresh counter without anyone doing
anything.

## The setup checklist points here

The hub's setup checklist carries an item — **"Your invoice numbering"** — that stays pending until
this hub has, **for the current fiscal year**, both an ordinary series (F1/F2/F3) *and* a **separate
rectifying series** (R1–R5). It is a 🔴 *functional* item: nothing is blocked, but until it is done
the numbering has not been looked at by a human.

Why it is not ticked by the first sale: the `TICKET` series is born on its own the first time
something is invoiced, prefix included, with nobody having chosen it — and the rectifying series the
tax authority requires separately is never created by a sale at all. The item is what brings you to
this screen to do two things:

- **check the prefix** your numbers will carry (a series per till, e.g. `VFT25-A`, is common
  practice), and
- if you are migrating from another system, **continue its numbering** instead of starting again at
  1 — interleaved series are the number-one failure when adapting to VeriFactu.
