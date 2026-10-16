// Re-match a posted entry's references (owner, 2026-10-16; docs/modules/
// UX_TIER3.md, G, decisions 164-165). New development, hand-written.
//
// A posted JV or CBT entry's vendor / customer lines say which open items
// (bills, earlier advances) they settle: their Against Ref allocations, the
// rest a New Ref (docs/modules/PARTY_PAYMENTS.md). A wrong pick used to be
// fixed only by reversing the whole entry, refused while another entry had
// settled one of its New Refs. Re-match changes only the allocations of its
// party lines, with a reason: the amounts, accounts and dates stay, so the
// books don't change; the SOA and the aging follow at once (they are
// derived from the allocations).
//
//   - its own right, "rematch" on the entry's module (JV or CBT; 164);
//   - allowed in a closed month: the books don't change (165);
//   - only a live entry (posted, not reversed, not a reversal) of the JV or
//     a CBT voucher type: PDCs, returns, retail sales, opening balances and
//     the other modules' entries keep their matching in their own module;
//   - each line's allocations are checked as at posting (resolvePartyLines),
//     as if this entry's own allocations were not there; a New Ref that
//     other entries settle can't fall below what they settle;
//   - kept in the entry's history: Rematches [{ At, By, ByName, Reason,
//     Changes: [{ LineNo, Before, After }] }].
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const { isLive, resolvePartyLines, liveEntriesAllocating, lineAmount } = require('./partyLedger');

const onCallOptions = { region: 'us-central1' };
const CBT_TYPES = ['Cash Receipt', 'Bank Receipt', 'Cash Payment', 'Bank Payment', 'Fund Transfer'];
const round2 = n => Math.round(n * 100) / 100;
const fmt = n => round2(n).toFixed(2);
const actorName = user => user.profile.fullName || user.profile.username || user.uid;

const moduleOf = e => (!e.VoucherType || e.VoucherType === 'JV') ? 'JV' : (CBT_TYPES.includes(e.VoucherType) ? 'CBT' : '');
const describe = allocs => (allocs || []).map(a => a.RefType === 'New' ? 'New Ref ' + fmt(a.Amount) : 'Against ' + (a.RefNumber || a.RefID) + ' ' + fmt(a.Amount)).join(' · ') || '—';
const sameAllocations = (a, b) => JSON.stringify((a || []).map(x => [x.RefType, x.RefID || '', round2(x.Amount)]).sort()) === JSON.stringify((b || []).map(x => [x.RefType, x.RefID || '', round2(x.Amount)]).sort());

exports.rematchJournalEntry = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const jvId = String(d.jvId || '').trim();
  const reason = String(d.reason || '').trim().slice(0, 500);
  if (!jvId) throw new HttpsError('invalid-argument', 'Choose the entry.');
  const ref = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(jvId);
  const first = await ref.get();
  if (!first.exists) throw new HttpsError('not-found', 'Journal entry not found.');
  const mod = moduleOf(first.data());
  if (!mod) throw new HttpsError('failed-precondition', 'This entry was posted by ' + first.data().VoucherType + ': its matching is kept in that module.');
  if (!(await moduleHasCapability(mod, 'rematch', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have permission to re-match entries (' + (mod === 'JV' ? 'Journal Entry' : 'Cash and Bank') + ': rematch).');
  }
  if (!userCanAccessCompany(user.profile, first.data().CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for the re-match.');
  const wanted = new Map((Array.isArray(d.lines) ? d.lines : []).map(l => [Number(l.LineNo), l.Allocations || []]));

  return withGlobalLock(user.uid, async () => {
    const entry = (await ref.get()).data();
    if (!isLive(entry)) throw new HttpsError('failed-precondition', 'Only a posted entry that is not reversed (and not itself a reversal) can be re-matched.');
    const lines = entry.Lines || [];
    for (const no of wanted.keys()) {
      const l = lines.find(x => Number(x.LineNo) === no);
      if (!l) throw new HttpsError('invalid-argument', 'Line ' + no + ' is not on this entry.');
      if (!l.PartyType) throw new HttpsError('invalid-argument', 'Line ' + no + ' has no vendor or customer: nothing to match.');
    }
    // The lines as they would be, checked as at posting without this entry's own allocations.
    const proposed = lines.map(l => wanted.has(Number(l.LineNo)) ? Object.assign({}, l, { Allocations: wanted.get(Number(l.LineNo)) }) : l);
    let resolved;
    try { resolved = await resolvePartyLines(proposed, entry.CompanyID, { excludeEntryId: jvId }); }
    catch (err) { throw new HttpsError('invalid-argument', err.message); }
    const changes = [];
    resolved.lines.forEach((l, i) => {
      const before = lines[i].Allocations || [];
      if (l.PartyType && !sameAllocations(before, l.Allocations)) changes.push({ LineNo: lines[i].LineNo, Before: describe(before), After: describe(l.Allocations) });
    });
    if (!changes.length) throw new HttpsError('failed-precondition', 'Nothing changed: the matching is as it was.');
    // A New Ref other entries settle can't shrink below what they settle.
    const newRefs = lines.filter(l => (l.Allocations || []).some(a => a.RefType === 'New')).map(l => 'NewRef:' + jvId + ':' + l.LineNo);
    if (newRefs.length) {
      const settled = new Map(), by = new Map();
      (await liveEntriesAllocating(newRefs)).filter(e => e._id !== jvId).forEach(e => (e.Lines || []).forEach(l => (l.Allocations || []).forEach(a => {
        if (a.RefType !== 'Against' || !newRefs.includes(a.RefID)) return;
        settled.set(a.RefID, round2((settled.get(a.RefID) || 0) + (Number(a.Amount) || 0)));
        by.set(a.RefID, [...new Set([...(by.get(a.RefID) || []), e.JVNumber || e._id])]);
      })));
      resolved.lines.forEach((l, i) => {
        const id = 'NewRef:' + jvId + ':' + lines[i].LineNo;
        const used = settled.get(id) || 0;
        const left = round2((l.Allocations || []).filter(a => a.RefType === 'New').reduce((s, a) => s + a.Amount, 0));
        if (used > left + 0.005) {
          throw new HttpsError('failed-precondition', 'Line ' + lines[i].LineNo + ': its New Ref is settled by ' + by.get(id).join(', ') + ' for ' + fmt(used) +
            ' — it can\'t become less than that (' + fmt(left) + ' of ' + fmt(lineAmount(lines[i])) + ').');
        }
      });
    }
    const at = new Date().toISOString();
    await ref.update(Object.assign({}, resolved.fields, {
      Lines: resolved.lines,
      Rematches: FieldValue.arrayUnion({ At: at, By: user.uid, ByName: actorName(user), Reason: reason, Changes: changes }),
      LastRematchedAt: at, LastRematchedBy: user.profile.username || user.uid
    }));
    return { success: true, changes };
  });
});
