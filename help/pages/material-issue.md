---
title: Material Issue
area: inventory
order: 4
modules: [MATERIALISSUE]
sources: [functions/src/materialIssue.js, functions/src/stockMovement.js]
summary: Issue stock to a department or process and keep the warehouse quantity and cost records aligned.
reviewed: 2026-10-12
fingerprint: 0f7eee9fc1fcca67
---
## What it is for

**Material Issue** records stock leaving the warehouse for a department, project or production use.

## Before you start

- The item is active in Item Master.
- The warehouse and stock quantity exist.
- The company is not in a closed period for the issue date.

## Step by step

1. Open **Material Issue** and select the company.
2. Choose the item, quantity and warehouse.
3. Add the department or reason for the issue.
4. Post the issue. The stock ledger and available balance update.

## What happens in the books

The issue reduces the warehouse balance and creates the related stock movement and value impact.

## Rights

Users need access and post rights. Some companies restrict issue posting to warehouse or stock roles.

## Questions and mistakes

- A stock issue can fail if the warehouse has insufficient available quantity.
- If a department is not allowed, check the company’s warehouse or project setup.
