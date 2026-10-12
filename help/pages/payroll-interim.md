---
title: Interim Payroll
area: hr
order: 9
modules: [PAYROLLIP]
sources: [functions/src/payrollInterim.js, functions/src/payrollFiles.js, functions/src/payrollPlan.js]
summary: Run an ad hoc or partial payroll when a monthly payroll needs an interim adjustment.
reviewed: 2026-10-12
fingerprint: 2547fbc8c6c344ad
---
## What it is for

**Interim Payroll** creates a controlled payment batch between monthly payroll runs. It pays eligible approved loans/advances, posted final settlements, and variable earnings explicitly marked for interim payment. It is not a second full salary run.

## Before you start

- The source item is ready: loan/advance is approved, final settlement is posted, or an eligible amount-based earning is marked Interim in Earnings and Deductions.
- Employee company, IBAN/WPS details, the bank file format, payment method, and payment date are checked.
- Approval Configuration for Interim Payroll is set up if required; the user has draft and pay rights.

## Step by step

1. Open Interim Payroll and start a batch for the company. Enter the payment date and optional note.
2. Select the eligible items to include. Each item can belong to only one batch at a time; review the employee, item type, and amount before saving.
3. Submit the draft batch. It follows configured approval; with no approval set up, submission approves it immediately. Rejection returns it to Draft for correction.
4. Once approved, review the payment plan by item. Generate and inspect the configured bank file where needed, then mark each item paid from the chosen cash/bank account.
5. Confirm all items are paid and the batch status is complete. If a payment must be undone, reverse the item's payment through the batch; the corresponding item becomes payable again and the batch returns to Draft when no live payment remains.

## What happens in the books

The approval/batch itself is not a GL posting. Payment creates the accounting entry for each item: a loan payout debits the loan receivable; a final settlement clears the settlement payable/receivable; an interim earning debits its pay element account; the cash or bank account is credited. Reversal creates mirror entries. These transactions do not become part of the monthly run's salary calculation.

## Rights

PAYROLLIP **access** allows viewing; **draft** allows creating and submitting batches; configured approvers decide; **pay** allows marking and reversing payments. Company access and valid cash/bank accounts still apply.

## Questions and mistakes

- **Expected item is absent:** confirm it is approved/posted as required, belongs to the selected company, is unpaid, and is not reserved by another batch.
- **An earning cannot be selected:** only eligible amount-based earnings marked Interim can be paid here; hourly overtime and accrual payouts are excluded.
- **Batch cannot be submitted:** it must contain at least one item that is still eligible when submitted.
- **Cannot change an item:** remove it from its Draft batch first. Submitted/approved batches must follow their status and payment reversal controls.
- **Payment fails:** check that the item is still unpaid, the payment date is valid, bank/cash account is active, and Payroll Setup has the item's account mapping.
- **Bank file preview is empty or incomplete:** check the format's record fields and employee IBAN/WPS data; only items set to be paid by bank appear in that bank file.
- **Batch total differs from expected:** compare its selected item list; the total is the sum of current eligible items and should be rechecked before submit.

## Related pages

[Payroll Setup](payroll-setup.html) · [Payroll Loan / Advance](payroll-loan.html) · [Final Settlement](payroll-final-settlement.html) · [Earnings and Deductions](payroll-earnings-deductions.html)
