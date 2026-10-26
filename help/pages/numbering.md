---
title: Numbering
area: admin
order: 8
modules: [NUMBERING]
sources: [functions/src/numbering.js]
summary: Maintain the document prefixes, numbering format and automatic code generation across modules.
reviewed: 2026-10-26
fingerprint: a3339ecc181a6c61
---
## What it is for

**Numbering** customizes the formats for document numbers and master codes. It groups numbered types by category, shows each current format and a sample, and records format changes in a log. Account codes and audit references such as TXN-, STK-, and PRL- are not configured here.

## Before you start

- The owner has approved the prefix, company-code inclusion, year, separator, sequence width, and order for the affected type.
- Check the current/default format and existing numbering before changing it; a format change affects new numbers only.
- Users can access Numbering; only users with the write right can save a format.

## Step by step

1. Open **Numbering** and search by type name or prefix. The table groups document numbers, master codes, and HR documents and shows a sample for company 01/current year. Each item category of your own (added in [Item Master](item-master.html)) has its own row under master codes, like the five. The **Proforma Invoice** (PI) series numbers the proformas printed from a [Sales Order](sales-order.html#proforma-invoice). Under HR documents, **Employee Request** (RQ) numbers the requests of the types HR sets up in [Employee Requests](employee-requests.html#request-types).
2. Select **Edit** for the exact type. Set the prefix (1–10 letters/digits), running-number width (3–10 digits), optional 2- or 4-digit year, optional company code, separator (dash, slash, or none), and year/company order where applicable.
3. Review the live sample. A year in the format creates a separate sequence per year; omitting the company code shares a sequence across companies. Company-code formats are unavailable for master types that do not belong to one company.
4. Save. The change is logged and applies only to numbers generated afterwards; existing documents and codes are not renamed.
5. Use **Reset to default** only when the old system format is intended. Reset restores the default format but does not reset the counter; new numbers continue from the existing counter.

## What happens in the books

Numbering configuration creates no journal and does not change existing records. At document creation, the selected format combines prefix, optional company/year, separator, and a zero-padded running counter. Customized formats are checked against other types to prevent overlapping number shapes; issued custom numbers are not reused.

## Rights

NUMBERING **access** controls viewing formats and the change log; **write** permits editing/resetting formats. Use a tightly restricted administrative role because changes affect all subsequent documents of that type.

## Questions and mistakes

- **Existing numbers did not change:** expected; Numbering is prospective, not a renumbering tool.
- **Sequence did not restart:** the format needs a year component for a separate annual sequence.
- **Companies share one sequence:** include the company code to scope the number by company, if the type supports it.
- **Format is rejected as a duplicate:** change the prefix or other parts so it cannot match another type's current, default, or previously used shape.
- **Reset did not start at 1:** reset restores the default format but retains its existing counter.
- **Account code or TXN-/STK-/PRL- reference is unchanged:** those are maintained by their owning accounting/audit sequences, not Numbering.

## Related pages

[Company Master](company-master.html) · [Journal Entries](journal-entries.html) · [Master Data Import](master-import.html)
