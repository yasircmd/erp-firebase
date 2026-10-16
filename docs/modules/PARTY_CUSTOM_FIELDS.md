# Vendor and customer: your own extra fields (UX Tier 3, K)

Status: **set aside** (owner, 2026-10-16: "skip all now"; questions 185–190 open for later).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, K).

## Today

- **Employees have extra fields** (HR Setup → Fields), and that is the
  model here:
  - each field has a label, a type (date, text or amount), a section, an
    order, Compulsory, Sensitive and Active;
  - the values are kept on the employee as `Custom`;
  - the employee screen shows them in their section;
  - Master Data Import adds one column per field;
  - a field's type can't change once any employee has a value in it;
  - sensitive fields are seen only with the sensitive right.
- **Vendor Master and Customer Master** are ported screens. Their save
  (`saveVendor` / `saveCustomer`) keeps a fixed list of fields, so nothing
  else can be stored. They are changed through documented patches, as the
  mobile-number rule was (customer-mobile-unique).
- No report or print reads the employee extra fields today.

## Proposal

The same **extra fields** for vendors and customers, each kept separately:

- a **Fields** tab on Procurement Setup (vendor fields) and on Sales
  Invoice Setup (customer fields), or both on one screen (question 189);
- types: text, date, amount and a **list** (choices you define), for
  example "Region", "Credit rating" or "Trade licence expiry";
- Compulsory and Active, the same rules as for employees;
- shown on the vendor / customer form under **More details**, saved with
  the record, logged as changes;
- in Master Data Import (one column per field) and in the Vendor / Customer
  list's **Copy to Excel**.

## Questions for the owner

- **185.** Which fields do you need first (two or three examples)? They
  decide whether text / date / amount / list is enough.
- **186.** Should a field also be usable as a **filter** on the vendor /
  customer lists and the aging reports (e.g. aging by Region)?
  Recommended: on the lists, yes; on reports later, if needed.
- **187.** Printed on documents (invoice, PO, statement)? Recommended:
  not now; it belongs with print customization (wave 3, R).
- **188.** Fields shared by all companies, or per company? Recommended:
  shared (vendors and customers can be shared too), each field optionally
  for one company only.
- **189.** Where to set the fields up: Procurement Setup (vendors) and
  Sales Invoice Setup (customers), or one new **Party Fields** screen?
  Recommended: the two setup screens, where each side's settings already
  are.
- **190.** Sensitive fields (seen only with a right), as for employees?
  Recommended: not needed for vendors and customers; say if any field is
  personal data.
