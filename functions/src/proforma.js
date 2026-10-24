// Proforma Invoice from a Sales Order (owner, 2026-10-24; docs/modules/
// UX_ROUND2.md item 22, decision Q275). New development, hand-written.
//
// A print of the Sales Order as "Proforma Invoice": it posts nothing. Its
// number is its own, from Numbering's PI series (doc:PI), given on the first
// print and kept on the order (ProformaNumber, ProformaIssuedAt), so every
// reprint shows the same number. Any saved order may print one; the screen
// marks a draft DRAFT. A cancelled order can't: it is no longer offered.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallInCorporate } = require('./callable');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const { salesOrders } = require('./salesStore');
const numbering = require('./numbering');

const onCallOptions = { region: 'us-central1' };

exports.issueProformaNumber = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('SALESORDER', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Sales Orders.');
  const soId = String(request.data && request.data.soId || '').trim();
  const find = async () => {
    const so = await salesOrders.get(soId);
    if (!so) throw new HttpsError('not-found', 'Sales Order not found. Save it first.');
    if (!userCanAccessCompany(user.profile, so.CompanyID)) throw new HttpsError('permission-denied', 'You are not assigned to this Sales Order\'s company.');
    if (so.Status === 'Cancelled') throw new HttpsError('failed-precondition', 'A cancelled Sales Order has no Proforma Invoice.');
    return so;
  };
  const so = await find();
  if (so.ProformaNumber) return { proformaNumber: so.ProformaNumber, issuedAt: so.ProformaIssuedAt || '' };
  // Under the lock, as the other document numbers: two first prints at once
  // give one number.
  return withGlobalLock(user.uid, async () => {
    const again = await find();
    if (again.ProformaNumber) return { proformaNumber: again.ProformaNumber, issuedAt: again.ProformaIssuedAt || '' };
    const year = Number(String(again.SODate || '').slice(0, 4)) || undefined;
    const proformaNumber = await numbering.next('doc:PI', { companyId: again.CompanyID, year });
    const issuedAt = new Date().toISOString();
    await salesOrders.update(soId, { ProformaNumber: proformaNumber, ProformaIssuedAt: issuedAt });
    return { proformaNumber, issuedAt };
  });
});
