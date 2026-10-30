---
title: Job Order Request
area: production
order: 1
modules: [JOBORDERREQUEST]
sources: [functions/src/stockMovement.js]
summary: Open a job order request to start production and confirm the required materials and output.
reviewed: 2026-10-30
fingerprint: 5cc7ce838085a025
---
## What it is for

**Job Order Request** records a manufacturing or production request before the production is released. It defines what is to be made, by when and in what quantity.

## Before you start

- The bill of materials and work centres are known.
- The production date and output target are agreed.
- The company’s production rules are active.

## Step by step

1. Open **Job Order Request** and select the company.
2. Enter the production item, quantity and required date.
3. Confirm the materials or cost basis associated with the job.
4. Submit or approve the request and move it into production.

## What happens in the books

The job order request is a planning record. The actual production posting and consumption entries happen later when the job is processed.

## Rights

Production planners and maintenance or admin users with job-order access usually use this screen.

## Questions and mistakes

- If the job is not created, check whether the item and production setup are active.
