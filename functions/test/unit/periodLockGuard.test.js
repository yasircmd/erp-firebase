// The period lock's guard (docs/modules/PERIOD_CLOSING.md, step 1b):
// nothing dated in a closed month is posted, sent for approval or reversed.
// The check sits at the few places every posting passes through; this test
// fails if one of them loses it, or if a file starts writing journal
// entries or posting stock movements without going through one of them.
// The Deploy workflow runs the unit tests before every deploy.
//   node --test functions/test/unit/periodLockGuard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
// A top-level function's body: from its declaration to the next top-level one.
function body(file, name) {
  const s = read(file);
  const start = s.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, file + ': function ' + name + ' not found');
  const rest = s.slice(start + 1);
  const end = rest.search(/^(async function|function|exports\.|module\.exports|const \w+ = )/m);
  return s.slice(start, end < 0 ? undefined : start + 1 + end);
}

test('the shared places every posting passes through check the lock', () => {
  const checks = [
    ['glWriting.js', 'buildStockGlEntry', /periodLock\.assertOpen\(dim\.CompanyID, transactionDate\)/],
    // step 1c: only payroll / depreciation reversals and redos may move to the first open month, and only with consent
    ['glWriting.js', 'buildStockGlEntry', /periodLock\.ADJUSTABLE_TYPES\.has\(stockTransactionType\) && \(redo \|\| extraFields\.ReversalOfJV\)\)[\s\S]*periodLock\.adjustableDate\(dim\.CompanyID, transactionDate, redo \|\| periodLock\.consentGiven\(\)\)/],
    ['glWriting.js', 'assignStockVoucherNumbering', /periodLock'\)\.assertOpen\(companyId, transactionDate\)/],
    ['approvals.js', 'beginApprovalInstance', /periodLock'\)\.assertDocumentOpen\(moduleId, documentId, documentNumber\)/],
    ['fixedAssetsCommon.js', 'assertFaPostingOpen', /periodLock'\)\.assertOpen\(companyId, date\)/],
    ['journal.js', 'postJournalEntry', /assertPeriodOpen\(existing\.CompanyID, existing\.JVDate\)/],
    ['journal.js', 'decideJournalEntryApproval', /assertPeriodOpen\(existing\.CompanyID, existing\.JVDate\)/],
    ['journal.js', 'reverseJournalEntry', /assertPeriodOpen\(existing\.CompanyID, date\)/],
    ['openingBalances.js', 'reverseEntry', /periodLock'\)\.assertOpen\(entry\.CompanyID, entry\.JVDate/]
  ];
  for (const [file, fn, re] of checks) assert.match(body(file, fn), re, file + ' ' + fn + ' must check the period lock');
  // The Apps Script ports: their entries go through glWriting; the invoice
  // reversals, which may wait for approval, check their date first.
  const legacy = read('legacy/codegs.js');
  for (const fn of ['requestReverseVendorInvoice', 'requestReverseCustomerInvoice']) {
    assert.match(body('legacy/codegs.js', fn), /await assertPeriodOpen_\(idToken, existing\.CompanyID, date\)/, fn);
  }
  assert.match(legacy, /const writeStockGlEntry_ = \(idToken, \.\.\.a\) => __glWriting\.writeStockGlEntry\(\.\.\.a\);/);
  assert.match(legacy, /const beginApprovalInstance_ = \(idToken, \.\.\.a\) => __approvals\.beginApprovalInstance\(\.\.\.a\);/);
  assert.doesNotMatch(legacy.replace(/FIRESTORE_JOURNAL_ENTRIES_COLLECTION, statusFilter|firestoreDelete_\(FIRESTORE_JOURNAL_ENTRIES_COLLECTION/g, ''), /firestore(Set|Add|Update)_\(FIRESTORE_JOURNAL_ENTRIES_COLLECTION/,
    'a ported module writes journal entries itself: route it through glWriting or check the lock');
});

// Every file that writes journal entries, and why it is covered. A new file
// writing them must check the lock and be listed here.
const JOURNAL_WRITERS = {
  'glWriting.js': 'buildStockGlEntry checks',
  'journal.js': 'JV / CBT: post, final approval, reversal check',
  'openingBalances.js': 'entries from buildStockGlEntry; its reversal checks',
  'fixedAssetsDepreciation.js': 'entries from buildStockGlEntry',
  'fixedAssetsPostings.js': 'entries from buildStockGlEntry',
  'fixedAssetsRetirement.js': 'entries from buildStockGlEntry',
  'stockPosting.js': 'entries from buildStockGlEntry: every stock posting, with its balances and documents in one batch (T1b)',
  'masterData.js': 'the Chart of Accounts recode: account codes only, no amount or date (decision 133)',
  'periodClosing.js': 'the year-end closing entry and its reversal: the close itself, the one posting allowed into a closed month (step 2)'
};
const writesJournal = s => /(FIRESTORE_JOURNAL_ENTRIES_COLLECTION|'journalEntries')\)\.doc\([^)]*\)\.(set|update|create)\(|\.(set|create)\((firestore\.collection|col)\(FIRESTORE_JOURNAL_ENTRIES_COLLECTION\)|firestore(Set|Update)_\(FIRESTORE_JOURNAL_ENTRIES_COLLECTION|collection\((FIRESTORE_JOURNAL_ENTRIES_COLLECTION|'journalEntries')\)\.add\(/.test(s);

test('every file that writes journal entries is covered by the lock', () => {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
  const writers = files.filter(f => writesJournal(read(f)));
  const unknown = writers.filter(f => !JOURNAL_WRITERS[f]);
  assert.deepEqual(unknown, [], 'writes journal entries without being listed: check the period lock there (periodLock.assertOpen), then list it');
  for (const f of writers.filter(f => /buildStockGlEntry/.test(JOURNAL_WRITERS[f]))) {
    assert.match(read(f), /buildStockGlEntry\(/, f + ' is listed as building its entries with buildStockGlEntry');
  }
});

test('every file that posts stock movements goes through a checked place', () => {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
  // Stock transactions are in Firestore through stockStore.js (T1); the scan
  // finds a file by either name.
  // Since T1b a stock posting goes through stockPosting.postStock, which
  // builds its entry with buildStockGlEntry (checked above).
  const posting = files.filter(f => { const s = read(f); return !['stockStore.js', 'stockPosting.js'].includes(f) && /stock\/transactions|stockStore\./.test(s) && /Status: 'Posted'|finalizeCommitAttempt\(|postStock\(/.test(s); });
  // Files that only read stock movements (their text matches the scan):
  const READ_ONLY = {
    'commitAttempt.js': 'finishes a posting its caller checked', 'periodClosing.js': 'the checklist reads stock; the year-end entry has no stock',
    'followUps.js': 'queries posted Delivery Notes for the home page', 'agingReports.js': 'queries posted stock for the aging report',
    'stockReports.js': 'queries posted stock for the reports'
  };
  const unchecked = posting.filter(f => !/(writeStockGlEntry|buildStockGlEntry|assignStockVoucherNumbering|postStock)\(/.test(read(f)) && !READ_ONLY[f]);
  assert.deepEqual(unchecked, [], 'posts stock movements without writing a checked GL entry or numbering');
  assert.ok(posting.includes('warehouseMovement.js') && posting.includes('grn.js'), 'the scan still finds the stock modules');
});

// A check after the stock ledger moved would refuse the document but keep
// the stock moved: in every function that moves the ledger, the checked call
// comes first.
test('the stock ledger moves only after the lock was checked', () => {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== 'stockMovement.js');
  const late = [];
  for (const f of files) {
    const s = read(f);
    const fns = s.split(/\n(?=(?:async )?function |exports\.\w+ = )/);
    for (const fn of fns) {
      const ledger = fn.indexOf('commitStockLedgerUpdates(');
      if (ledger < 0) continue;
      const checked = fn.search(/(writeStockGlEntry|buildStockGlEntry|assignStockVoucherNumbering)\(/);
      if (checked < 0 || checked > ledger) late.push(f + ': ' + fn.slice(0, 80).split('\n')[0]);
    }
  }
  assert.deepEqual(late, [], 'commitStockLedgerUpdates before the period-checked call');
  // T1b: postStock builds the entry (its period check) before the batch that
  // moves the ledger is committed; a posting without an entry (Warehouse
  // Movement) is numbered, and so checked, before it calls postStock.
  const post = body('stockPosting.js', 'postStock');
  assert.ok(post.indexOf('buildStockGlEntry(') >= 0 && post.indexOf('buildStockGlEntry(') < post.indexOf('batch.commit()'), 'postStock builds the checked entry before it commits');
  for (const f of files) {
    for (const fn of read(f).split(/\n(?=(?:async )?function |exports\.\w+ = )/)) {
      const at = fn.indexOf('postStock(user, null');
      if (at < 0) continue;
      const checked = fn.indexOf('assignStockVoucherNumbering(');
      if (checked < 0 || checked > at) late.push(f + ': ' + fn.slice(0, 80).split('\n')[0]);
    }
  }
  assert.deepEqual(late, [], 'a posting without a GL entry is numbered (checked) before postStock');
});

test('the guard notices an unlisted writer (the scan itself works)', () => {
  assert.ok(writesJournal("await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(id).set(record);"));
  assert.ok(writesJournal("batch.set(firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(b.jvId), b.record)"));
  assert.ok(writesJournal("await firestoreSet_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, newId, rec)"));
  assert.ok(!writesJournal("await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', c).get()"));
});
