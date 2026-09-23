# Invoicing — Limits and troubleshooting

## Known gaps you should know about

**The "ask for an invoice for this ticket" button does not exist yet.** The substitution command
works, but the Invoices screen does not offer it. Until it is wired, an F3 has to be issued through
the API.

**Every sale is invoiced as F2.** The sale's choice of ticket versus full invoice does not travel in
the event, so an invoice created from a sale is always a simplified F2 in the `TICKET` series. To get
a full invoice for that sale, issue a substituting F3.

**An invoice line stores the rate and the category, but not the country, region or rule id.** Only
two of the sale's five frozen fiscal fields travel in the event.

## Errors and refusals

| Situation | What happens | What to do |
|---|---|---|
| Marking a `draft`, `paid` or `cancelled` invoice as paid | Nothing changes — only `issued` invoices can be marked paid | Check the status first |
| Rectifying an already-rectifying or cancelled invoice | The action is not offered, and the command is a no-op if it is called anyway — no number consumed, nothing cancelled | You cannot rectify a rectification |
| Rectifying the same invoice twice by hand | Resolves to the existing rectification — no second number, no second document | One whole rectification per invoice; look for the one that already exists |
| Refunding a sale in several acts | Each refund gets its own rectifying invoice for the amount returned; the closing act takes what is left | One rectification per refund document; they add up to the original to the cent |
| Issuing a second F3 for the same F2 | Resolves to the existing F3 | One substitution per ticket, by design |
| The same sale event delivered twice | Resolves to the existing invoice | Idempotent by source; nothing to do |
| Creating a series whose code and year already exist | Rejected | Codes are unique per hub and year |
| Trying to change a series' code, year or counter | Not accepted | Those are the fiscal identity of the numbering |
| Changing the number format of a series that already issued | Not accepted — the field is locked and the change is ignored | The number is in the VeriFactu chain; create a new series |
| A number format with no `{seq}` placeholder | Rejected before it reaches the database | Every invoice would get the same number; add `{seq}` or `{seq:0Nd}` |
| Creating an invoice with no lines | Rejected | At least one line is required |
| A line whose tax category is reverse charge, not subject or exempt but still charges a rate | Refused before anything is written — no number consumed, nothing issued | Only a subject operation may carry a quota (the tax authority rejects the rest). Fix the tax rule of that category so it charges 0 % |
| Issuing a manual **full** invoice (F1) without the customer's tax ID | Refused before anything is written — no number consumed, nothing issued | A complete invoice needs an identified recipient (the tax authority rejects it with error 1189). Add the customer's tax ID, or issue from a simplified ticket (F2) series |

## Caps and sizes

| Limit | Value |
|---|---|
| Rows per page (invoices, series, numbering book) | 50 |
| Maximum rows a paginated request may ask for | 500 |
| Invoices per sale | 1 |
| Substituting invoices per ticket | 1 |
| Default series list sort | invoices by id ascending; series by name ascending |

## Permissions per action

| To do this | You need |
|---|---|
| See invoices, their lines and the series | `invoice.view_invoice` |
| Create an invoice, create one from a sale, issue a substitution, mark one paid | `invoice.add_invoice` |
| Issue a rectifying invoice | `invoice.rectify_invoice` |
| Create or change a numbering series (the **Settings** tab) | `invoice.manage_series` |

By role: **admin** and **manager** have everything. **employee** can only **see** invoices and
**create** them — an employee **cannot rectify** an invoice and cannot touch the series.

**Who sees the Settings tab.** The navigation entry is gated by `invoice.manage_series`: the menu
does not offer the tab to anyone who cannot open it. That is the third layer, not the only one —
the tab still hides the series form without the permission, and the runtime refuses
`invoice.series.create` / `invoice.series.update` without it regardless of what the screen shows.
There is no separate "module settings" permission — the only thing this module configures is the
numbering series.

## Dependencies — what breaks if something is missing

**`taxes` and `sales` are required** and are installed automatically with Invoicing. You cannot
uninstall either while Invoicing is installed.

- Without `sales`, nothing emits `sale.completed`, so no invoice is ever created automatically. Manual
  invoices still work.
- Without `taxes`, the rule catalogue cannot be read and the breakdown falls back to treating the
  operation as a plain domestic taxable sale. **The amounts do not change**, but the fiscal
  qualification is generic — which matters if you actually sell something exempt.

**`verifactu` is optional but expected in Spain.** Without it, invoices are issued but nothing is
reported to the tax authority.

## When something looks wrong

**"I sold something and no invoice appeared."** Check that Invoicing is installed and that `sales` is
emitting. Note the invoice is created by the event, not by the sale screen — it may take a moment.

**"There are two invoices for one sale."** There cannot be; the origin makes it idempotent. If you see
two, check their source: one is probably a manual invoice or a substitution.

**"I need to change an amount on an invoice."** You cannot. Rectify it and issue a correct one.

**"I rectified an invoice and the original is still visible."** That is correct. It is marked
`cancelled` and stays in the record. Fiscal history is never removed.

**"The customer wants an invoice and I already gave them a ticket."** Do **not** rectify — nothing was
wrong. Issue a substituting F3.

**"The numbering has a gap."** The counter only moves forward and never rewinds, so a gap means an
attempt that did not complete. Do not try to reuse the number; that is worse than the gap. Ask
`invoice.numbering.gaps` — it names the series and the exact stretch that is missing, and returns
**nothing at all** when the numbering is correlative. `invoice.numbering.allocations` then shows what
each number was used for. Note the book only covers numbers handed out **since the module was updated
to the version that added it**; nothing before that was back-filled.

**"The counter restarted at 1."** A new year starts a new counter for the same series code. That is
correct.

**"Two series are both marked default."** They cannot be for the same year. Check the year column —
each year has its own default.

**"A 0 % line looks the same as an exempt line."** In the breakdown they are not the same, and should
not be. Check the operation class and the exemption reason on the entry, not just the rate.
