// Task emails, phase 2 (owner, 2026-11-09; docs/modules/TASK_EMAILS.md,
// Q457-Q460): each corporate's own sending mailbox, and each company's, set in
// Company Master. New development, hand-written.
//
//   Firestore mailAccounts/{CORPORATE | companyId}
//     { Address, Password (encrypted, never sent back), UpdatedAt, UpdatedBy,
//       LastTest: { At, To, Result } }
//
// The password is AES-256-GCM encrypted under the firm's secret TASK_MAIL_KEY
// (a copy of the database alone never reveals it); only the functions that
// declare that secret can read it. An email about a document goes from its
// company's mailbox, else the corporate's (Q457); with neither it is not sent
// (Q460), never from another corporate's mailbox (Q458). Corporate 100's
// default stays the firm's secret TASK_MAIL_ACCOUNT unless set here.
// Rights: Company Master "write" (Q459), and the company's access.
'use strict';
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');

const MAIL_KEY = defineSecret('TASK_MAIL_KEY');
const onCallOptions = { region: 'us-central1', secrets: [MAIL_KEY] };
const CORPORATE = 'CORPORATE';
const ACCOUNTS = () => firestore.collection('mailAccounts');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------- pure: the encryption ----------

const keyOf = secret => crypto.createHash('sha256').update(String(secret)).digest();
function encrypt(plain, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}
// The password, or null when it can't be read (another key, or tampered with).
function decrypt(blob, secret) {
  try {
    const [v, iv, tag, body] = String(blob || '').split(':');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  } catch (err) {
    return null;
  }
}
const keyNow = () => { const k = MAIL_KEY.value(); return k && String(k).trim() ? String(k).trim() : ''; };

// ---------- the sender's view: which account sends ----------

// { user, pass } of a saved mailbox, or { error } (none, or not readable).
async function savedAccount(id, secret) {
  if (!id) return { error: 'none' };
  const s = await ACCOUNTS().doc(String(id)).get();
  if (!s.exists) return { error: 'none' };
  const a = s.data();
  if (!secret) return { error: 'not sent: the firm\'s mail key (TASK_MAIL_KEY) is not set' };
  const pass = decrypt(a.Password, secret);
  if (pass === null) return { error: 'not sent: the saved password of ' + a.Address + ' can\'t be read (the mail key changed?): save it again in Company Master' };
  return { user: a.Address, pass: pass.replace(/\s+/g, '') };
}

// The mailbox for an email: its company's, else the corporate's, else
// (Corporate 100 only) the firm's; else { error } (Q460). opts: { companyId,
// secret, firmAccount (only ever given for Corporate 100) }.
async function accountFor(opts) {
  const o = opts || {};
  if (o.companyId) {
    const own = await savedAccount(o.companyId, o.secret);
    if (!own.error) return own;
    if (own.error !== 'none') return own;
  }
  const corp = await savedAccount(CORPORATE, o.secret);
  if (!corp.error) return corp;
  if (corp.error !== 'none') return corp;
  if (o.firmAccount) return o.firmAccount;
  return { error: require('./taskMail').NO_ACCOUNT };
}

// ---------- Company Master: the screen's calls ----------

async function requireWrite(user) {
  if (!(await moduleHasCapability('COMPANYMASTER', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have the right to change Company Master.');
}
async function checkKey(user, key) {
  const id = text(key, 80);
  if (id === CORPORATE) return id;
  if (!id || !(await rtdb.ref('companies/' + id).get()).exists()) bad('Choose a company.');
  if (!userCanAccessCompany(user.profile, id)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return id;
}
const view = d => (d ? { Address: d.Address || '', HasPassword: Boolean(d.Password), UpdatedAt: d.UpdatedAt || '', UpdatedBy: d.UpdatedBy || '', LastTest: d.LastTest || null } : null);

// { corporate, companies: { id: view }, canWrite, keySet }: the companies the user may see.
exports.getMailAccounts = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('COMPANYMASTER', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Company Master.');
  const snap = await ACCOUNTS().get();
  const out = { corporate: null, companies: {}, canWrite: await moduleHasCapability('COMPANYMASTER', 'write', user.profile.role), keySet: Boolean(keyNow()) };
  snap.docs.forEach(d => {
    if (d.id === CORPORATE) out.corporate = view(d.data());
    else if (userCanAccessCompany(user.profile, d.id)) out.companies[d.id] = view(d.data());
  });
  return out;
});

// Save (the password only when given: blank keeps the saved one), or remove.
exports.saveMailAccount = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const d = request.data || {};
  const id = await checkKey(user, d.key);
  const ref = ACCOUNTS().doc(id);
  if (d.remove === true) { await ref.delete(); return { success: true, removed: true }; }
  const address = text(d.address, 200).toLowerCase();
  if (!ADDRESS.test(address)) bad('Enter the sending mailbox\'s address.');
  const password = String(d.password == null ? '' : d.password).replace(/\s+/g, '');
  const old = await ref.get();
  const fields = { Address: address, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid };
  if (password) {
    const secret = keyNow();
    if (!secret) throw new HttpsError('failed-precondition', 'The firm\'s mail key (TASK_MAIL_KEY) is not set yet: ask the firm.');
    if (password.length < 8) bad('Paste the mailbox\'s app password (16 letters).');
    fields.Password = encrypt(password, secret);
    fields.LastTest = null;
  } else if (!(old.exists && old.data().Password)) {
    bad('Enter the mailbox\'s app password.');
  } else if (old.data().Address !== address) {
    bad('A new address needs its own app password.');
  }
  await ref.set(fields, { merge: true });
  return { success: true };
});

// The test email's own core (for the tests): sends, and says what happened.
async function sendTest(account, to, transport) {
  if (account.error) return account.error === 'none' ? 'not sent: no mail account set' : account.error;
  try {
    await transport.sendMail({ from: '"ERP tasks" <' + account.user + '>', to, subject: 'ERP task emails: test',
      text: 'This mailbox sends your ERP task emails. If this arrived in spam, see Help: Task emails.\n\nThis is an automatic email: please do not reply.' });
    return 'sent';
  } catch (err) {
    return 'failed: ' + text(err && err.message, 300);
  }
}

// A test email from that mailbox to the person asking (its address and password proved).
exports.testMailAccount = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const id = await checkKey(user, (request.data || {}).key);
  const to = text(user.profile.email, 200);
  if (!to) throw new HttpsError('failed-precondition', 'Your ERP user has no email address to send the test to.');
  const account = await savedAccount(id, keyNow());
  const transport = account.error ? null : require('./taskMail').transportFor(account);
  const result = await sendTest(account, to, transport);
  if (!account.error || account.error !== 'none') await ACCOUNTS().doc(id).set({ LastTest: { At: new Date().toISOString(), To: to, Result: result } }, { merge: true }).catch(() => {});
  return { success: result === 'sent', result, to };
});

module.exports = Object.assign(exports, { CORPORATE, MAIL_KEY, encrypt, decrypt, savedAccount, accountFor, sendTest });
