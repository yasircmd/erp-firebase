// Item categories of your own, beyond the five (owner, 2026-10-16;
// docs/modules/ITEM_CATEGORIES_CUSTOM.md, decisions 203-207). New
// development, hand-written.
//
// itemCategories/{id} { Name, Prefix, BaseCategory, CompanyID, Status }:
//   - its own code prefix and sequence (204): SP-000001, a numbering type
//     of its own (numbering.js), formatted in Numbering like the five;
//   - it behaves like one of the five (BaseCategory), which the item keeps
//     as its Category, so BOM, Job Orders, Production, stock and costing
//     are unchanged; the item's CustomCategoryID gives its code, its name
//     on Item Master and its sub-categories (ParentCategory 'X-<id>');
//   - shared by all companies or one company's (206);
//   - added by anyone with Item Master access (205);
//   - existing items stay where they are (207): an item's category never
//     changes after it is made.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const numbering = require('./numbering');

const onCallOptions = { region: 'us-central1' };
const PATH = 'itemCategories';
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const BUILT_IN = () => Object.keys(numbering.ITEM_CATEGORY_PREFIXES).map(k => ({ Key: k, Name: numbering.ITEM_LABELS[k], Prefix: numbering.ITEM_CATEGORY_PREFIXES[k] }));
const keyOf = id => 'X-' + id; // a sub-category's ParentCategory, Item Master's value

async function requireAccess(user) {
  if (!(await moduleHasCapability('ITEMMASTER', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Item Master.');
}
const all = async () => (await rtdb.ref(PATH).get()).val() || {};
const listOf = (cats, user) => Object.keys(cats).map(id => Object.assign({ ItemCategoryID: id, Key: keyOf(id) }, cats[id]))
  .filter(c => !c.CompanyID || userCanAccessCompany(user.profile, c.CompanyID)).sort((a, b) => String(a.Name).localeCompare(String(b.Name)));

exports.getItemCategories = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  return { builtIn: BUILT_IN(), categories: listOf(await all(), user) };
});

exports.saveItemCategory = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const d = (request.data || {}).category || {};
  const id = text(d.ItemCategoryID, 80);
  const name = text(d.Name, 60);
  if (name.length < 2) bad('Enter the category\'s name.');
  const cats = await all();
  const now = new Date().toISOString(), by = user.profile.username || user.uid;
  const sameName = (c, co) => String(c.Name).toLowerCase() === name.toLowerCase() && (!c.CompanyID || !co || c.CompanyID === co);
  if (id) {
    // Only the name and status change: the prefix, the base and the company are the items' (207).
    const cur = cats[id];
    if (!cur) throw new HttpsError('not-found', 'Item category not found.');
    if (cur.CompanyID && !userCanAccessCompany(user.profile, cur.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (Object.keys(cats).some(k => k !== id && sameName(cats[k], cur.CompanyID))) bad('There is already a category "' + name + '".');
    const status = d.Status === 'Inactive' ? 'Inactive' : 'Active';
    await rtdb.ref(PATH + '/' + id).update({ Name: name, Status: status, UpdatedAt: now, UpdatedBy: by });
    return { success: true, itemCategoryId: id };
  }
  const prefix = text(d.Prefix, 6).toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(prefix)) bad('The code prefix is 2 to 6 letters or digits, starting with a letter (for example SP).');
  const base = text(d.BaseCategory, 30);
  if (!numbering.ITEM_CATEGORY_PREFIXES[base]) bad('Choose which of the five it behaves like (for BOM and production).');
  const co = text(d.CompanyID, 80);
  if (co && !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (co && !(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  if (BUILT_IN().some(b => b.Name.toLowerCase() === name.toLowerCase()) || Object.values(cats).some(c => sameName(c, co))) bad('There is already a category "' + name + '".');
  if (Object.values(cats).some(c => String(c.Prefix).toUpperCase() === prefix)) bad('Another category already has the prefix ' + prefix + '.');
  const clash = await numbering.prefixClash(prefix);
  if (clash) bad('The prefix ' + prefix + ' would give the same codes as ' + clash + ': choose another.');
  const ref = rtdb.ref(PATH).push();
  await ref.set({ Name: name, Prefix: prefix, BaseCategory: base, CompanyID: co, Status: 'Active', CreatedAt: now, CreatedBy: by, CreatedByName: user.profile.fullName || by, UpdatedAt: now, UpdatedBy: by });
  return { success: true, itemCategoryId: ref.key, key: keyOf(ref.key) };
});

// For the item's save (patch item-custom-category): the category, checked
// against the base category and company the item is saved with. Throws Error.
async function checkForItem(id, baseCategory, companyId, isNew) {
  const c = (await rtdb.ref(PATH + '/' + id).get()).val();
  if (!c) throw new Error('Item category not found.');
  if (isNew && c.Status === 'Inactive') throw new Error('The category "' + c.Name + '" is no longer in use.');
  if (c.BaseCategory !== baseCategory) throw new Error('The category "' + c.Name + '" behaves like ' + numbering.ITEM_LABELS[c.BaseCategory] + ', not ' + (numbering.ITEM_LABELS[baseCategory] || baseCategory) + '.');
  if (c.CompanyID && c.CompanyID !== companyId) throw new Error('The category "' + c.Name + '" belongs to ' + (companyId ? 'another company' : 'one company; a shared item uses a shared category') + '.');
  return c;
}
// A sub-category's parent: one of the five, or 'X-<id>' of a category of your own.
async function validParent(parent) {
  if (numbering.ITEM_CATEGORY_PREFIXES[parent]) return true;
  const m = /^X-(.+)$/.exec(String(parent || ''));
  return Boolean(m && (await rtdb.ref(PATH + '/' + m[1]).get()).exists());
}

module.exports = Object.assign(exports, { checkForItem, validParent, keyOf });
