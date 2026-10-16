// Shareholders in Company Master (owner, 2026-10-16; docs/modules/UX_TIER3.md,
// F, decisions 162-163). New development, hand-written.
//
// Per company: the issued shares, and its shareholders (name, nationality,
// ID or passport number, shares held, from date, to date). The % is worked
// out of the issued shares. The shares need not add up to them (162): a
// total other than 100% is warned, not refused. History is kept: a
// shareholder who sold gets a to date and stays, as a past shareholder; a
// record entered by mistake can be removed with a reason. Every change is
// in the log.
//
// It is personal data (163): its own right, Company Master "shareholders",
// to see it; changing it needs Company Master's write right as well. It is
// stored apart from the company record (which every Company Master user
// reads): RTDB companyShareholders/{companyId}:
//   IssuedShares: number (0 = not entered),
//   Holders: { id: { Name, Nationality, IDNumber, Shares, FromDate, ToDate,
//                    CreatedAt, CreatedBy, UpdatedAt, UpdatedBy } },
//   Log: { pushId: { Action, Name, Text, By, ByName, At } }.
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn, TIME_ZONE } = require('./recurringSchedule');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'COMPANYMASTER';
const PATH = 'companyShareholders/';
const MAX_HOLDERS = 200;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const round4 = n => Math.round(n * 1e4) / 1e4;
const round2 = n => Math.round(n * 100) / 100;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const today = () => todayIn(TIME_ZONE);

async function rights(user) {
  const [access, see, write] = await Promise.all(['access', 'shareholders', 'write'].map(c => moduleHasCapability(MODULE_ID, c, user.profile.role)));
  return { CanView: access && see, CanEdit: access && see && write };
}
async function requireRight(user, edit) {
  const r = await rights(user);
  if (!r.CanView) throw new HttpsError('permission-denied', 'You do not have permission to see shareholders (Company Master, "shareholders").');
  if (edit && !r.CanEdit) throw new HttpsError('permission-denied', 'You do not have permission to change shareholders (Company Master: write).');
  return r;
}
async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}
const load = async co => (await rtdb.ref(PATH + co).get()).val() || {};

// Current on `day`: from its from date, up to and including its to date.
const stateOf = (h, day) => h.FromDate > day ? 'Future' : (h.ToDate && h.ToDate < day ? 'Past' : 'Current');

function view(data, r, day) {
  const issued = Number(data.IssuedShares) || 0;
  const holders = Object.entries(data.Holders || {}).map(([id, h]) => Object.assign({ ShareholderID: id }, h, { State: stateOf(h, day) }));
  const current = holders.filter(h => h.State === 'Current');
  const held = round4(current.reduce((s, h) => s + (Number(h.Shares) || 0), 0));
  holders.forEach(h => { h.Percent = issued ? round2((Number(h.Shares) || 0) / issued * 100) : null; });
  const order = { Current: 0, Future: 1, Past: 2 };
  holders.sort((a, b) => order[a.State] - order[b.State] || (Number(b.Shares) || 0) - (Number(a.Shares) || 0) || String(a.Name).localeCompare(String(b.Name)));
  const percent = issued ? round2(held / issued * 100) : null;
  let warning = '';
  if (!issued && current.length) warning = 'Enter the issued shares to work out each shareholder\'s % and check the total.';
  else if (issued && Math.abs(held - issued) > 1e-9) warning = 'The current shareholders hold ' + held + ' of the ' + issued + ' issued shares (' + percent + '%), not 100%.';
  return {
    IssuedShares: issued, Holders: holders, Current: { Count: current.length, Shares: held, Percent: percent }, Warning: warning, AsOf: day,
    Log: Object.values(data.Log || {}).sort((a, b) => String(b.At).localeCompare(String(a.At))).slice(0, 100),
    CanView: r.CanView, CanEdit: r.CanEdit
  };
}

const logEntry = (user, action, name, detail) => ({ Action: action, Name: name || '', Text: detail || '', By: user.uid, ByName: actorName(user), At: new Date().toISOString() });
const describe = h => [h.Shares + ' shares', 'from ' + h.FromDate, h.ToDate ? 'to ' + h.ToDate : ''].filter(Boolean).join(', ');

// { companyId } → the shareholders; { rightsOnly: true } → just the rights
// (Company Master shows the Shareholders button by them).
exports.getCompanyShareholders = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  if (d.rightsOnly) return rights(user);
  const r = await requireRight(user, false);
  const co = await companyFor(user, d.companyId);
  return view(await load(co), r, today());
});

exports.saveCompanyIssuedShares = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await requireRight(user, true);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const issued = Number(d.issuedShares);
  if (!(issued >= 0) || !isFinite(issued) || round4(issued) !== issued) throw new HttpsError('invalid-argument', 'Issued shares: a number, zero or more (up to 4 decimals).');
  const before = Number((await rtdb.ref(PATH + co + '/IssuedShares').get()).val()) || 0;
  const updates = { IssuedShares: issued };
  updates['Log/' + rtdb.ref().push().key] = logEntry(user, 'Issued shares', '', before + ' → ' + issued);
  await rtdb.ref(PATH + co).update(updates);
  return Object.assign({ success: true }, view(await load(co), r, today()));
});

exports.saveCompanyShareholder = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await requireRight(user, true);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const h = d.shareholder || {};
  const rec = {
    Name: text(h.Name, 150), Nationality: text(h.Nationality, 60), IDNumber: text(h.IDNumber, 40),
    Shares: Number(h.Shares), FromDate: text(h.FromDate, 10), ToDate: text(h.ToDate, 10)
  };
  if (!rec.Name) throw new HttpsError('invalid-argument', 'Enter the shareholder\'s name.');
  if (!(rec.Shares > 0) || !isFinite(rec.Shares) || round4(rec.Shares) !== rec.Shares) throw new HttpsError('invalid-argument', 'Shares held: a number above zero (up to 4 decimals).');
  if (!isDate(rec.FromDate)) throw new HttpsError('invalid-argument', 'Enter the date the shares were held from.');
  if (rec.ToDate && !isDate(rec.ToDate)) throw new HttpsError('invalid-argument', 'The to date is not a valid date.');
  if (rec.ToDate && rec.ToDate < rec.FromDate) throw new HttpsError('invalid-argument', 'The to date is before the from date.');
  const data = await load(co);
  const id = text(h.ShareholderID, 40);
  const before = id ? (data.Holders || {})[id] : null;
  if (id && !before) throw new HttpsError('not-found', 'That shareholder is no longer on the list.');
  if (!id && Object.keys(data.Holders || {}).length >= MAX_HOLDERS) throw new HttpsError('failed-precondition', 'At most ' + MAX_HOLDERS + ' shareholder records per company.');
  const now = new Date().toISOString(), actor = user.profile.username || user.uid;
  const sid = id || 'SH-' + randomUUID().split('-')[0].toUpperCase();
  const updates = {};
  updates['Holders/' + sid] = Object.assign({}, rec, { CreatedAt: before ? before.CreatedAt : now, CreatedBy: before ? before.CreatedBy : actor, UpdatedAt: now, UpdatedBy: actor });
  const what = before ? (before.ToDate !== rec.ToDate && rec.ToDate && !before.ToDate ? 'Left' : 'Change') : 'Add';
  updates['Log/' + rtdb.ref().push().key] = logEntry(user, what, rec.Name, before ? describe(before) + ' → ' + describe(rec) : describe(rec));
  await rtdb.ref(PATH + co).update(updates);
  return Object.assign({ success: true, shareholderId: sid }, view(await load(co), r, today()));
});

// A record entered by mistake (a shareholder who sold gets a to date instead).
exports.removeCompanyShareholder = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const r = await requireRight(user, true);
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const reason = text(d.reason, 300);
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for removing the record.');
  const id = text(d.shareholderId, 40);
  const h = ((await load(co)).Holders || {})[id];
  if (!h) throw new HttpsError('not-found', 'That shareholder is no longer on the list.');
  const updates = {};
  updates['Holders/' + id] = null;
  updates['Log/' + rtdb.ref().push().key] = logEntry(user, 'Removed', h.Name, describe(h) + ' — ' + reason);
  await rtdb.ref(PATH + co).update(updates);
  return Object.assign({ success: true }, view(await load(co), r, today()));
});
