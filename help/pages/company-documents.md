---
title: Company Documents
area: admin
order: 11
modules: [COMPANYDOCS]
sources: [functions/src/companyDocuments.js, functions/src/attachments.js]
summary: Track company, vendor, customer, and other-party documents, files, renewals, removals, and 30-day expiry reminders.
reviewed: 2026-10-17
fingerprint: 01ec4e993fe707c1
---
## What it is for

**Company Documents** is the register for company, vendor, customer, and other-party legal records such as licences, contracts, leases, insurance, and tax registrations. It tracks issue/expiry dates, renewal chains, files, category, status, and audit history.

## Before you start

- Company Documents access and company access are assigned to the users who maintain or review records.
- The company, category, title/reference, party (if any), issue date, expiry date, and required files are known.
- Admin has set up the needed document categories. Expiry reminders appear 30 days before expiry and continue after the document expires for users who can maintain the register.

## Step by step

### Add or maintain a record

1. Open Company Documents. Search by title/reference/party, and filter by company, category, and status. **Current** excludes renewed/superseded and removed records; **Attention** shows expiring or expired records.
2. Add a document with company, category, title, optional reference, optional party, issue/start date, expiry date, and notes. For Vendor or Customer, select the party; for Other, enter the party name. Company documents can have no party.
3. Attach supporting files in the document section. Save and verify the file count/status on the record.
4. Use **Terminate** for a document no longer in force. Keep the record rather than replacing its history.

### Renew or remove

1. Open an Active or Terminated document and select **Renew**. Enter the new record's dates/reference/files and save it.
2. Renewal creates a new version linked to the previous record; the old record becomes Superseded and remains in the version/history chain. Attach the new files to the new version.
3. Use **Remove** only when the record/files should be removed from normal use. Supply a reason; the record remains as Removed and its stored files move to Removed rather than being silently deleted.

### Categories

Admin can add, rename, or deactivate categories. Deactivating a category prevents it being selected for new documents but leaves it displayed on records that already use it.

## What happens in the books

Company Documents does not post to the ledger. It maintains compliance evidence and expiry reminders. Vendor/customer documents are also visible from their party masters when the user has Company Documents access.

## Rights

COMPANYDOCS **access** controls viewing; **write** creates, edits, renews, terminates, and removes records. Only Admin can manage categories. Company access applies. Expiry tasks are sent to users who have both access and write rights.

## Questions and mistakes

- **Document is not on the current list:** it may be Superseded or Removed; change the status filter to find its history.
- **No expiry reminder:** check the expiry date, whether it is within 30 days or overdue, and that the user has both access and write rights.
- **Renewal changed the old document:** renewal should create a new version and preserve the old one as Superseded; open the version chain to verify.
- **Vendor/customer is unavailable:** confirm the party belongs to the selected company or is shared.
- **Category is unavailable:** check whether Admin has marked it active; inactive categories remain on existing documents but cannot be newly selected.
- **A file was removed:** review the removal reason and storage's Removed area; removal is audited, not an untracked delete.

## Related pages

[Document Storage](document-storage.html) · [Company Master](company-master.html) · [Vendor Master](vendor-master.html) · [Customer Master](customer-master.html)
