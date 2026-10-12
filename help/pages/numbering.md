---
title: Numbering
area: admin
order: 8
modules: [NUMBERING]
sources: [functions/src/numbering.js]
summary: Maintain the document prefixes, numbering format and automatic code generation across modules.
reviewed: 2026-10-12
fingerprint: 1154005a4c85b4ac
---
## What it is for

**Numbering** defines how document references and codes are formed across the ERP, including prefixes, year markers and document-size rules.

## Before you start

- The company’s document numbering policy is agreed.
- The ERP user knows which module ranges and codes are affected.

## Step by step

1. Open **Numbering**.
2. Select the document or master type.
3. Define the numbering format and reset or suffix rules as required.
4. Save and test the next generated document number.

## What happens in the books

This is a configuration document. The actual document number is used when the transaction is created.

## Rights

Admin or finance support roles usually maintain numbering settings.

## Questions and mistakes

- If a new document is using the wrong sequence, check the numbering format and the company or code that was selected.
