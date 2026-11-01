// The credit check, customer credit control step C2 (owner, 2026-10-31;
// docs/modules/CREDIT_CONTROL.md, Q362-Q365). New development, hand-written.
//
// Confirming a Sales Order and posting a Customer Invoice (Q363; direct
// invoices and invoices from orders or deliveries alike) check the
// customer's standing in the company (creditControl.standings):
//   - a credit hold (Q364) refuses the sale whatever the setting: lift the
//     hold in Credit Control to sell on credit;
//   - over the limit (the exposure plus what this document adds) or
//     overdue past the grace days (Q362), the company's setting (Q365):
//       Off    no check;
//       Warn   refused with WARN until the user continues (the request's
//              consent .go), then goes ahead with it recorded on the
//              document (CreditCheck), for the approvers;
//       Block  refused; a user with Credit Control's "override" right may go
//              ahead with a reason (consent .go and .reason), recorded.
// The consent rides with the request as budgetConsent (budgetConsent.js,
// carried by callable.js for every callable): one consent store for the
// request's checks, so no callable changes. The screens look for the
// markers below (keep in step with them).
//
// What a document adds (in base): a Sales Order its whole value at its
// prices; a Customer Invoice its total, less, where the company counts
// deliveries and orders in the exposure, the deliveries and order lines it
// invoices (already counted there).
'use strict';
const { rtdb } = require('./firebaseAdmin');
const { moduleHasCapability } = require('./auth');
const K = require('./creditCalc');
const { consent } = require('./budgetConsent');

const WARN = 'Over credit (warning)';
const BLOCK_OVERRIDE = 'Over credit (blocked; you may override with a reason)';
const BLOCK = 'Over credit (blocked)';
const HOLD = 'On credit hold';
const fmt = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A document's currency to base, today.
async function rateOfCurrencyId(currencyId) {
  if (!currencyId) return 1;
  const c = (await rtdb.ref('currencies/' + currencyId).get()).val();
  const X = require('./exchangeRates');
  const base = await X.baseCurrency();
  if (!c || !c.Code || !base.Code || c.Code === base.Code) return 1;
  const S = require('./recurringSchedule');
  return (await X.rateOn(c.Code, S.todayIn(S.TIME_ZONE), base)).Rate;
}

// What the document adds to the exposure, in base.
async function addition(moduleId, doc, exposureMode) {
  if (moduleId === 'SALESORDER') {
    const so = Object.assign({}, doc, { Lines: (doc.Lines || []).map(l => Object.assign({}, l, { DeliveredQuantity: 0 })) });
    return K.round2(K.openOrderValue(so) * await rateOfCurrencyId(doc.CurrencyID));
  }
  return K.invoiceAddition(doc, exposureMode);
}

// The check: null when nothing stands against the customer (or the check is
// off), else the record to keep on the document; throws when the user must decide.
async function checkDocument(user, moduleId, doc) {
  const companyId = doc.CompanyID, customerId = doc.CustomerID;
  if (!companyId || !customerId) return null;
  const C = require('./creditControl');
  const { rows, setup } = await C.standings(companyId, [customerId]);
  const row = rows[0];
  if (!row) return null;
  const who = (row.Code ? row.Code + ' ' : '') + row.Name;
  if (row.Hold) throw new Error(HOLD + ': ' + who + ' (' + row.HoldReason + ', ' + row.HoldBy + '). Lift the hold in Credit Control to sell to it on credit.');
  if (setup.Check === 'Off') return null;
  const add = await addition(moduleId, doc, setup.Exposure);
  const s = K.standing(row, add);
  const over = s.Flags.includes('OverLimit'), late = s.Flags.includes('Overdue');
  if (!over && !late) return null;
  const parts = [];
  if (over) parts.push('credit limit ' + fmt(row.Limit) + ', exposure ' + fmt(row.Exposure) + ', this document ' + fmt(add) + ', over by ' + fmt(s.Over));
  if (late) parts.push(fmt(row.Overdue) + ' overdue, the oldest ' + row.OverdueDays + ' days past its due date');
  const text = who + ': ' + parts.join('; and ');
  const record = { Mode: setup.Check, Exposure: setup.Exposure, GraceDays: Number(setup.GraceDays) || 0, Limit: row.Limit, ExposureBefore: row.Exposure, Document: add,
    Over: s.Over, Overdue: row.Overdue, OverdueDays: row.OverdueDays, Flags: s.Flags, Text: text, By: user.profile.username || user.uid, At: new Date().toISOString() };
  const c = consent();
  if (setup.Check === 'Warn') {
    if (c.go) return Object.assign(record, { Accepted: true });
    throw new Error(WARN + ' ' + text + '. Continue anyway? The approvers will see it.');
  }
  const may = await moduleHasCapability('CREDITCONTROL', 'override', user.profile.role);
  if (may && c.go && c.reason) return Object.assign(record, { Overridden: true, Reason: c.reason });
  if (may) throw new Error(BLOCK_OVERRIDE + ' ' + text + '.');
  throw new Error(BLOCK + ' ' + text + '. Someone with the right to override credit control can go ahead, or the limit can be raised.');
}

module.exports = { checkDocument, addition, WARN, BLOCK_OVERRIDE, BLOCK, HOLD };
