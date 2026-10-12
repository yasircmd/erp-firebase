---
title: Production
area: production
order: 3
modules: [PRODUCTION]
sources: [functions/src/stockMovement.js]
summary: Post the completion of a production job and record the finished output into stock.
reviewed: 2026-10-12
fingerprint: 949c48a04dfb0113
---
## What it is for

**Production** records the output created from a job order. It converts the planned effort and materials into a finished item that becomes available in stock.

## Before you start

- The job order and BOM are in place.
- The items and required quantities are known.
- The production date and warehouse are ready.

## Step by step

1. Open **Production** and select the job order or item to produce.
2. Review the planned output and actual quantities manufactured.
3. Enter the produced quantity and confirm the warehouse.
4. Post the production, which creates the stock movement for the finished goods.

## What happens in the books

The production posting updates stock and creates the related value movement for the produced goods and any material consumption.

## Rights

Production users and relevant finance roles generally need the right to create and post production entries.

## Questions and mistakes

- If stock does not increase as expected, review the production quantities and the warehouse assignment.
