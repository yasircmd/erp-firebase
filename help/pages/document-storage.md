---
title: Document Storage
area: admin
order: 10
modules: [DOCUMENTSTORAGE]
sources: [functions/src/documentStorage.js, functions/src/attachments.js]
summary: Store and retrieve supporting files for modules, documents and approvals without going outside the ERP.
reviewed: 2026-10-17
fingerprint: 0bc652be1e2ee53b
---
## What it is for

**Document Storage** is the Admin setup screen for the private file provider used by supporting-document sections throughout the ERP. In production, the ERP connects to Google Drive using an Admin-managed OAuth client and refresh token; users open files through the ERP and do not receive direct access to the storage folder.

## Before you start

- Admin has created a Google OAuth Web application client and added the exact redirect URI shown by the screen.
- The connected Drive account is the approved account for business documents and can keep the private ERP Documents folder.
- Client ID and secret are available to Admin through the approved secure setup process; the secret is stored server-side and is not shown again.

## Step by step

1. Open Document Storage as Admin. Review the connection status and displayed redirect URI.
2. Save the OAuth client ID and secret. Connect Google Drive and sign in as the account that will own/maintain the files; grant the requested access.
3. Use **Test connection** to confirm the integration can write, read back, and remove a small test file. Refresh the screen to verify connection details.
4. Files are organized under ERP Documents by company, document year, voucher type, and document number. Unnumbered drafts use Drafts and are moved after numbering; removed documents/files are moved to Removed rather than silently erased.
5. If the connection is lost, reconnect the account. Disconnect only when planned: users cannot add/open supporting files until the connection is restored, though existing Drive files remain there.

## What happens in the books

Document Storage configuration and file operations create no journal entries. Files are stored separately from accounting records and linked to their ERP documents through the attachment service. The Drive connection and OAuth credentials are handled server-side.

## Rights

Only Admin can open Document Storage and connect/disconnect the provider. Other users add/open supporting files only through the relevant module rights and company access; they do not browse the Drive folder directly.

## Questions and mistakes

- **Connect button is disabled:** save both OAuth client ID and secret first; confirm the redirect URI is registered with Google.
- **Connection test fails:** reconnect the approved Drive account and check the OAuth client/consent configuration before users upload more files.
- **A user cannot open a Drive folder:** that is expected; files are opened through ERP records, not by granting direct folder access.
- **A document is under Drafts or Removed:** draft numbering moves files into their final document folder; removals are retained in the Removed folder for audit.
- **Disconnecting storage:** this interrupts all file add/open operations; it does not delete existing files from Drive.

## Related pages

[Company Documents](company-documents.html) · [Getting Started](getting-started.html)
