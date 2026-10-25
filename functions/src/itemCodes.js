// Item user codes for the shell (owner, 2026-10-24; docs/modules/
// ITEM_USER_CODE.md, decisions Q276, Q293). New development, hand-written.
//
// The system code (ItemCode) stays every line's key; the shell shows an
// item's user code wherever its system code is shown, and takes it where an
// item is typed (public/index.html, ITEM CODES). This gives the shell the
// pairs, for the items of the user's companies and the shared ones.
'use strict';
const { onCallInCorporate } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');

const onCallOptions = { region: 'us-central1' };

// { [ItemCode]: UserCode } for the items that have one.
exports.getItemUserCodes = onCallInCorporate(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const items = (await rtdb.ref('items').get()).val() || {};
  const out = {};
  Object.values(items).forEach(i => {
    if (i && i.ItemCode && i.UserCode && userCanAccessCompany(user.profile, i.CompanyID)) out[i.ItemCode] = i.UserCode;
  });
  return out;
});
