// Employee requests of any type (UX round 2, item 27; docs/modules/
// EMPLOYEE_REQUEST_TYPES.md, Q277, Q305-Q308): types set up by "setup" with
// their fields, route, days and document answer; the portal's form and a
// request checked against its fields, numbered RQ-; straight to the handler
// (due in the type's days, overdue on Home) or through the line manager
// first (Team: approve or reject); a certificate resolved only with HR's
// file; reopened within 14 days; types per company.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, PROJECT } = require('./_helpers');

test.after(async () => { await app.delete(); });

const AUTH = 'http://127.0.0.1:9099';
const PDF = Buffer.from('%PDF-1.4\n% certificate\n').toString('base64');
let ALI, SARA, BEN, CERT, IT;
const UID = {};
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const er = (uid, action, data) => call(uid, 'employeeRequests', Object.assign({ action }, data || {}));
const reqDoc = async id => (await firestore.collection('employeeRequests').doc(id).get()).data();
async function portalUser(code, pw, newPw) {
  const res = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: code.toLowerCase() + '@ess.invalid', password: pw, returnSecureToken: true })
  });
  const uid = (await res.json()).localId;
  await ess(uid, 'changePassword', { newPassword: newPw });
  return uid;
}

// Ali (EMP-0001) reports to Sara (EMP-0002); Ben (EMP-0003) has no manager.
test.before(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  f.permissions.EMPREQUESTS = { access: ['Admin', 'Viewer'], handle: ['Admin'], setup: ['Admin'] };
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1', Gender: 'Male' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  BEN = await emp({ FullName: 'Ben Okafor' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI, SARA, BEN] });
  UID.ALI = await portalUser('EMP-0001', 'alih0001', 'Sunrise#2026');
  UID.SARA = await portalUser('EMP-0002', 'sara0002', 'Garden#2026');
  UID.BEN = await portalUser('EMP-0003', 'beno0003', 'Harbour#2026');
});

test('types: set up by "setup" with their fields, route, days and document answer; checked', async () => {
  const save = (d, uid) => er(uid || 'u-admin', 'saveType', d);
  const cert = { name: 'Salary certificate', description: 'For a bank or an embassy.', route: 'Manager', answerDays: 3, documentAnswer: true,
    fields: [{ Label: 'Addressed to', Kind: 'text', Required: true }, { Label: 'Purpose', Kind: 'choice', Options: ['Bank loan', 'Visa', 'Other'], Required: true },
      { Label: 'Needed by', Kind: 'date' }, { Label: 'Stamped copy', Kind: 'yesno' }] };
  await assert.rejects(save(cert, 'u-viewer'), /permission to set up/);
  await assert.rejects(save(Object.assign({}, cert, { name: '' })), /Give the type a name/);
  await assert.rejects(save(Object.assign({}, cert, { name: 'Overtime' })), /portal's own requests/);
  await assert.rejects(save(Object.assign({}, cert, { answerDays: 0 })), /from 1 to 365/);
  await assert.rejects(save(Object.assign({}, cert, { fields: [{ Label: 'Purpose', Kind: 'choice', Options: ['One'] }] })), /at least two options/);
  await assert.rejects(save(Object.assign({}, cert, { fields: [{ Label: 'X', Kind: 'colour' }] })), /what kind of field/);
  CERT = (await save(cert)).typeId;
  await assert.rejects(save(Object.assign({}, cert, { name: 'salary CERTIFICATE' })), /already a type called/);
  IT = (await save({ name: 'IT support', route: 'Handler', fields: [{ Label: 'Problem', Kind: 'longtext', Required: true }, { Label: 'Screenshot', Kind: 'file' }] })).typeId;
  await save({ name: 'Company car', route: 'Handler', companyIds: ['C2'] }, 'u-other');
  const list = (await er('u-viewer', 'types')).types;
  assert.deepEqual(list.map(t => t.Name), ['Company car', 'IT support', 'Salary certificate']);
  // The Handlers tab offers each type as a category.
  assert.ok((await er('u-admin', 'handlers')).categories.includes('Salary certificate'));
  // The portal: the employee's company's types only (Q308).
  const form = await ess(UID.ALI, 'requestForm');
  assert.deepEqual(form.types.map(t => t.Name), ['IT support', 'Salary certificate']);
});

test('a request of a type: its fields checked, numbered RQ-; straight to the handler and due in the days; resolved; reopened', async () => {
  await er('u-admin', 'saveHandler', { companyId: 'C1', category: 'IT support', handlerUid: 'u-approver' });
  await assert.rejects(ess(UID.BEN, 'raiseRequest', { typeId: IT, answers: {} }), /Fill in Problem/);
  const r = await ess(UID.BEN, 'raiseRequest', { typeId: IT, answers: { problem: 'The laptop will not start.' } });
  assert.match(r.number, /^RQ-\d{4}-0001$/);
  assert.deepEqual([r.status, r.assignedTo], ['New', 'Approver']);
  let d = await reqDoc(r.requestId);
  assert.deepEqual([d.Type, d.Category, d.TypeName, d.DueDate, d.Answers.map(a => [a.Label, a.Value])], ['Custom', 'IT support', 'IT support', '', [['Problem', 'The laptop will not start.']]], 'no days: no due date');

  // HR: the first reply moves it to In progress; resolved; the employee reopens.
  const tasks = (await er('u-approver', 'tasks')).items;
  assert.deepEqual(tasks.filter(t => t.DocumentID === r.requestId).map(t => t.What), ['New request']);
  await er('u-approver', 'reply', { id: r.requestId, text: 'Bring it to IT at 10.' });
  assert.equal((await reqDoc(r.requestId)).Status, 'InProgress');
  await er('u-approver', 'resolve', { id: r.requestId, text: 'Replaced the charger.' });
  const mine = await ess(UID.BEN, 'request', { id: r.requestId });
  assert.deepEqual([mine.request.StatusText, mine.request.Title, mine.canReopen, mine.request.Answers[0].Value], ['Done', 'IT support', true, 'The laptop will not start.']);
  assert.deepEqual(mine.request.History.map(h => h.Event), ['Sent', 'Resolved']);
  await ess(UID.BEN, 'reopenQuery', { id: r.requestId, text: 'It stopped again.' }); // the same action as a query's
  assert.equal((await reqDoc(r.requestId)).Status, 'InProgress');
});

test('through the line manager first; a certificate is resolved only with HR\'s file; due and overdue', async () => {
  const base = { typeId: CERT, answers: { 'addressed-to': 'National Bank', purpose: 'Bank loan', 'needed-by': '2026-11-15', 'stamped-copy': true } };
  await assert.rejects(ess(UID.ALI, 'raiseRequest', Object.assign({}, base, { answers: Object.assign({}, base.answers, { purpose: 'Holiday' }) })), /Choose Purpose from its list/);
  await assert.rejects(ess(UID.ALI, 'raiseRequest', Object.assign({}, base, { answers: Object.assign({}, base.answers, { 'needed-by': '15/11/2026' }) })), /Needed by is a date/);
  const r = await ess(UID.ALI, 'raiseRequest', base);
  assert.equal(r.status, 'WithManager');
  let d = await reqDoc(r.requestId);
  assert.deepEqual([d.ManagerName, d.DueDate, d.Answers.find(a => a.Key === 'stamped-copy').Value], ['Sara Khan', '', 'Yes'], 'due only once with HR');
  assert.deepEqual((await er('u-admin', 'tasks')).items.filter(t => t.DocumentID === r.requestId), [], 'not HR\'s yet');

  // Sara's Team: approves.
  const team = await ess(UID.SARA, 'team');
  assert.deepEqual(team.requests.map(x => [x.Number, x.EmployeeName, x.TypeName]), [[r.number, 'Ali Hassan', 'Salary certificate']]);
  await assert.rejects(ess(UID.BEN, 'decideTeamRequest', { id: r.requestId, decision: 'Approved' }), /Only the employee's line manager/);
  await ess(UID.SARA, 'decideTeamRequest', { id: r.requestId, decision: 'Approved' });
  d = await reqDoc(r.requestId);
  assert.equal(d.Status, 'New');
  assert.match(d.DueDate, /^\d{4}-\d{2}-\d{2}$/, 'due in 3 days from today');

  // Overdue once the date has passed (shown, not blocking).
  await firestore.collection('employeeRequests').doc(r.requestId).update({ DueDate: '2026-01-01' });
  const t = (await er('u-admin', 'tasks')).items.find(x => x.DocumentID === r.requestId);
  assert.deepEqual([t.What, t.Overdue], ['New request · overdue', true]);
  assert.equal((await er('u-admin', 'list')).requests.find(x => x.RequestID === r.requestId).Overdue, true);

  // A document is the answer: refused until HR attaches it.
  await assert.rejects(er('u-admin', 'resolve', { id: r.requestId, text: 'Certificate issued.' }), /Attach the document/);
  await call('u-admin', 'useTestDocumentStorage', {});
  await call('u-admin', 'uploadAttachment', { module: 'EMPREQUESTS', docId: r.requestId, fileName: 'salary-certificate.pdf', data: PDF });
  await er('u-admin', 'resolve', { id: r.requestId, text: 'Certificate issued.' });
  const mine = await ess(UID.ALI, 'request', { id: r.requestId });
  assert.deepEqual([mine.request.StatusText, mine.request.DocumentAnswer, mine.files.map(f => f.FileName)], ['Done', true, ['salary-certificate.pdf']]);
  assert.deepEqual(mine.request.History.map(h => h.Event), ['Sent', 'With the line manager', 'Approved by the line manager', 'Sent to HR', 'Resolved']);

  // Rejected by the manager, with a reason.
  const r2 = await ess(UID.ALI, 'raiseRequest', base);
  await assert.rejects(ess(UID.SARA, 'decideTeamRequest', { id: r2.requestId, decision: 'Rejected', reason: '' }), /Give the reason/);
  await ess(UID.SARA, 'decideTeamRequest', { id: r2.requestId, decision: 'Rejected', reason: 'Ask after your probation.' });
  assert.deepEqual([(await reqDoc(r2.requestId)).Status, (await reqDoc(r2.requestId)).RejectionReason], ['Rejected', 'Ask after your probation.']);

  // No line manager: straight to HR.
  const r3 = await ess(UID.BEN, 'raiseRequest', Object.assign({}, base, { answers: Object.assign({}, base.answers) }));
  assert.equal(r3.status, 'New');
  assert.deepEqual((await reqDoc(r3.requestId)).History.map(h => h.Event), ['Sent', 'No line manager: sent to HR']);
});
