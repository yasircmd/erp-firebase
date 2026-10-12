---
title: Master Data Import
area: admin
order: 9
modules: [MASTERIMPORT]
sources: [functions/src/masterImport.js]
summary: Import item, supplier, customer or other master data in bulk and make the ERP updates reliably.
reviewed: 2026-10-12
fingerprint: b43a46033f1d0c76
---
## What it is for

**Master Data Import** is the bulk upload screen used to import or refresh master records in the ERP, often for items, suppliers, customers or employee data.

## Before you start

- The import file is prepared and validated.
- The mapping between the file and the ERP columns is known.
- The company and update mode are agreed before upload.

## Step by step

1. Open **Master Data Import**.
2. Select the import type and company.
3. Upload the file and review the mapping.
4. Run the import and fix any validation or row-level errors.

## What happens in the books

The import creates or updates the relevant master records. It does not usually create a separate finance entry by itself.

## Rights

Admin and data support users typically have access to this screen.

## Questions and mistakes

- If a row fails, check the mapping and whether the data already exists in the ERP as a different record type or company.
