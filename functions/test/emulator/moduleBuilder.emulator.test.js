// Module Builder, phase 1 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q461-Q469): the firm defines and publishes; a published module is a module
// (rights, registry); its records: a master (codes unique per company), a
// document (number, links, lines and totals, statuses, approval through
// Approval Configuration, edits only while editable, delete a first-status
// one); a new version may not retype a published field.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };

const ROOM = { id: 'X_ROOM', label: 'Room', kind: 'master', fields: [
  { key: 'roomType', label: 'Room type', type: 'choice', options: ['Single', 'Double'], required: true },
  { key: 'rate', label: 'Rate per night', type: 'amount' }], listColumns: ['roomType', 'rate'] };
const BOOKING = { id: 'X_BOOKING', label: 'Booking', kind: 'document', numbering: { prefix: 'BK' }, fields: [
  { key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER', required: true },
  { key: 'arrival', label: 'Arrival', type: 'date', required: true },
  { key: 'vip', label: 'VIP', type: 'yesno' }],
  lines: { enabled: true, label: 'Rooms', fields: [
    { key: 'room', label: 'Room', type: 'link', target: 'X_ROOM', required: true },
    { key: 'nights', label: 'Nights', type: 'number', required: true },
    { key: 'amount', label: 'Amount', type: 'amount' }] },
  statuses: [{ name: 'Draft' }, { name: 'Confirmed', approval: true }, { name: 'Checked out', final: true }, { name: 'Cancelled', final: true }],
  listColumns: ['guest'] };

function fixture() {
  const f = baseFixture();
  f.customers = { K1: { CustomerCode: 'C-001', CustomerName: 'Example Guest LLC', CompanyID: 'C1', Status: 'Active' }, K2: { CustomerCode: 'C-002', CustomerName: 'Other Co Guest', CompanyID: 'C2', Status: 'Active' } };
  // Rights for the built modules, as Roles & Permissions would set them.
  f.permissions.X_ROOM = { access: ['Admin', 'Viewer'], write: ['Admin'] };
  f.permissions.X_BOOKING = { access: ['Admin', 'Viewer'], write: ['Admin'], void: ['Admin'] };
  return f;
}
async function publish(def) {
  const s = await call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }).catch(e => (/already exists/.test(e.message) ? call('u-admin', 'saveModuleDefinitionDraft', { definition: def }) : Promise.reject(e)));
  ok(s);
  return ok(await call('u-admin', 'publishModuleDefinition', { id: def.id }));
}

test('the builder: the firm\'s right; a definition checked; a draft, then a published version; a published field keeps its type', async () => {
  await reset(fixture());
  // A viewer may open the builder, not change or publish (Module Builder: write, publish).
  assert.deepEqual((await call('u-viewer', 'getModuleDefinitions', {})).rights, { write: false, publish: false });
  assert.match(await refused(call('u-viewer', 'saveModuleDefinitionDraft', { definition: ROOM, isNew: true })), /Module Builder: write/);
  const save = def => refused(call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }));
  assert.match(await save(Object.assign({}, ROOM, { id: 'ROOM' })), /starts with X_/);
  assert.match(await save(Object.assign({}, ROOM, { fields: [{ key: 'code', label: 'Code', type: 'text' }] })), /kept for the ERP/);
  assert.match(await save(Object.assign({}, ROOM, { fields: [{ key: 'kind', label: 'Kind', type: 'choice' }] })), /needs its options/);
  assert.match(await save(Object.assign({}, BOOKING)), /choose what it links to/, 'X_ROOM is not published yet');
  assert.match(await save(Object.assign({}, BOOKING, { id: 'X_B2', statuses: [{ name: 'Only' }] })), /at least two statuses|choose what it links to/);
  assert.match(await save(Object.assign({}, ROOM, { id: 'X_' })), /starts with X_/);

  ok(await call('u-admin', 'saveModuleDefinitionDraft', { definition: ROOM, isNew: true }));
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { definition: ROOM, isNew: true })), /already exists/);
  let list = await call('u-admin', 'getModuleDefinitions', {});
  assert.deepEqual(list.definitions.map(d => [d.id, d.version]), [['X_ROOM', 0]]);
  assert.match(await refused(call('u-admin', 'getBuiltModule', { moduleId: 'X_ROOM' })), /Unknown module/, 'a draft is not a module');
  assert.equal(ok(await call('u-admin', 'publishModuleDefinition', { id: 'X_ROOM' })).version, 1);
  const m = await call('u-admin', 'getBuiltModule', { moduleId: 'X_ROOM' });
  assert.deepEqual([m.definition.label, m.definition.version, m.rights.write, m.companies.map(c => c.id)], ['Room', 1, true, ['C1']]);
  // In the registry: Roles & Permissions and Tree Management see it.
  const reg = await call('u-admin', 'getModuleRegistry', {});
  const listOf = r => (Array.isArray(r) ? r : (r && (r.modules || r.registry)) || []);
  assert.ok(listOf(reg).some(x => (x.id || x.ModuleID) === 'X_ROOM'), 'X_ROOM in the registry: ' + JSON.stringify(reg).slice(0, 200));

  // Version 2: a field added is fine; a field retyped is refused.
  ok(await call('u-admin', 'saveModuleDefinitionDraft', { definition: Object.assign({}, ROOM, { fields: ROOM.fields.concat([{ key: 'floor', label: 'Floor', type: 'number' }]) }) }));
  assert.equal(ok(await call('u-admin', 'publishModuleDefinition', { id: 'X_ROOM' })).version, 2);
  assert.match(await refused(call('u-admin', 'saveModuleDefinitionDraft', { definition: Object.assign({}, ROOM, { fields: [{ key: 'rate', label: 'Rate', type: 'text' }] }) })), /keeps its type/);
  assert.match(await refused(call('u-admin', 'deleteModuleDefinitionDraft', { id: 'X_ROOM' })), /published module is not deleted/);
  list = await call('u-admin', 'getModuleDefinitions', {});
  assert.deepEqual(list.masters, ['X_ROOM']);
  assert.deepEqual((await call('u-admin', 'getModuleDefinition', { id: 'X_ROOM' })).versions.map(v => v.version), [2, 1]);
});

test('records: a master\'s codes, a document\'s number, links, lines and totals, statuses and approval', async () => {
  await reset(fixture());
  await publish(ROOM);
  await publish(BOOKING);
  const save = (mod, record, uid) => call(uid || 'u-admin', 'saveBuiltRecord', { moduleId: mod, record });

  // Masters: a code once per company; a choice from its list; rights.
  const r101 = ok(await save('X_ROOM', { CompanyID: 'C1', Code: '101', Name: 'Garden room', Fields: { roomType: 'Double', rate: '450.5' } })).id;
  ok(await save('X_ROOM', { CompanyID: 'C1', Code: '102', Name: 'Sea room', Fields: { roomType: 'Single', rate: 300 } }));
  assert.match(await refused(save('X_ROOM', { CompanyID: 'C1', Code: '101', Name: 'Dup', Fields: { roomType: 'Single' } })), /already used/);
  assert.match(await refused(save('X_ROOM', { CompanyID: 'C1', Code: '103', Name: 'X', Fields: { roomType: 'Suite' } })), /choose one of its options/);
  assert.match(await refused(save('X_ROOM', { CompanyID: 'C1', Code: '103', Name: 'X', Fields: {} })), /Room type is required/);
  assert.match(await refused(save('X_ROOM', { CompanyID: 'C1', Code: '103', Name: 'X', Fields: { roomType: 'Single' } }, 'u-viewer')), /right to change Room/);
  assert.match(await refused(save('X_ROOM', { CompanyID: 'C2', Code: '1', Name: 'X', Fields: { roomType: 'Single' } })), /access to that company/);
  const rooms = (await call('u-viewer', 'listBuiltRecords', { moduleId: 'X_ROOM' })).records;
  assert.deepEqual(rooms.map(r => [r.Code, r.Fields.roomType, r.Fields.rate]), [['101', 'Double', 450.5], ['102', 'Single', 300]]);

  // A document: links chosen from the company's records only; lines totalled; numbered.
  const opts = (await call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_BOOKING', target: 'CUSTOMER', companyId: 'C1' })).options;
  assert.deepEqual(opts, [{ id: 'K1', label: 'C-001 · Example Guest LLC' }]);
  const roomOpts = (await call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_BOOKING', target: 'X_ROOM', companyId: 'C1' })).options;
  assert.deepEqual(roomOpts.map(o => o.label), ['101 · Garden room', '102 · Sea room']);
  assert.match(await refused(call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_BOOKING', target: 'VENDOR', companyId: 'C1' })), /no such link/);
  const doc = { CompanyID: 'C1', Date: '2026-11-09', Fields: { guest: { id: 'K1' }, arrival: '2026-11-20', vip: true },
    Lines: [{ room: { id: r101 }, nights: 3, amount: '1,351.50' }, {}, { room: { id: r101 }, nights: '1', amount: 450.5 }] };
  assert.match(await refused(save('X_BOOKING', Object.assign({}, doc, { Fields: { guest: { id: 'K2' }, arrival: '2026-11-20' } }))), /Guest: choose one from the list/);
  assert.match(await refused(save('X_BOOKING', Object.assign({}, doc, { Lines: [{ room: { id: r101 } }] }))), /Line 1: Nights is required/);
  const b = ok(await save('X_BOOKING', doc));
  assert.equal(b.number, 'BK-26-000001');
  let rec = (await call('u-admin', 'getBuiltRecord', { moduleId: 'X_BOOKING', id: b.id })).record;
  assert.deepEqual([rec.Status, rec.Lines.length, rec.Totals, rec.Fields.guest, rec.Fields.vip], ['Draft', 2, { nights: 4, amount: 1802 }, { id: 'K1', label: 'C-001 · Example Guest LLC' }, true]);
  assert.equal(ok(await save('X_BOOKING', Object.assign({}, doc, { Date: '2026-12-01' }))).number, 'BK-26-000002');

  // To Confirmed: needs approval when Approval Configuration has levels for it.
  await rtdb.ref('approvalConfigurations/X_BOOKING').set({ Enabled: true, ScopeType: 'Global', GateType: 'Flat' });
  await rtdb.ref('approvalLevels/X_BOOKING/GLOBAL/Levels').set([{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }]);
  const moved = ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_BOOKING', id: b.id, status: 'Confirmed' }));
  assert.deepEqual([moved.status, moved.pending], ['Draft', 'Confirmed']);
  assert.match(await refused(save('X_BOOKING', Object.assign({ RecordID: b.id }, doc))), /waiting for approval/);
  const tasks = await call('u-approver', 'getPendingApprovalsForUser', {});
  assert.deepEqual(tasks.map(t => [t.ModuleID, t.DocumentNumber, t.ModuleLabel, t.Amount]), [['X_BOOKING', 'BK-26-000001', 'Booking', 1802]]);
  const seen = await call('u-approver', 'getBuiltRecord', { moduleId: 'X_BOOKING', id: b.id });
  assert.equal(seen.approval.myLevel, 1);
  assert.match(await refused(call('u-admin', 'decideBuiltApproval', { moduleId: 'X_BOOKING', id: b.id, levelNumber: 1, decision: 'Approved' })), /not the assigned approver/);
  ok(await call('u-approver', 'decideBuiltApproval', { moduleId: 'X_BOOKING', id: b.id, levelNumber: 1, decision: 'Approved' }));
  rec = (await call('u-admin', 'getBuiltRecord', { moduleId: 'X_BOOKING', id: b.id })).record;
  assert.deepEqual([rec.Status, rec.PendingStatus], ['Confirmed', '']);
  // Confirmed isn't editable; a final status needs "void".
  assert.match(await refused(save('X_BOOKING', Object.assign({ RecordID: b.id }, doc))), /Confirmed can't be changed/);
  await rtdb.ref('permissions/X_BOOKING/void').set(['Nobody']);
  assert.match(await refused(call('u-admin', 'setBuiltStatus', { moduleId: 'X_BOOKING', id: b.id, status: 'Checked out' })), /void/);
  await rtdb.ref('permissions/X_BOOKING/void').set(['Admin']);
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_BOOKING', id: b.id, status: 'Checked out' }));
  assert.match(await refused(call('u-admin', 'setBuiltStatus', { moduleId: 'X_BOOKING', id: b.id, status: 'Draft' })), /can't become Draft/);

  // A rejection keeps its status and shows in the submitter's rejected items; delete only a Draft.
  const b2 = (await call('u-admin', 'listBuiltRecords', { moduleId: 'X_BOOKING', status: 'Draft' })).records[0].RecordID;
  ok(await call('u-admin', 'setBuiltStatus', { moduleId: 'X_BOOKING', id: b2, status: 'Confirmed' }));
  ok(await call('u-approver', 'decideBuiltApproval', { moduleId: 'X_BOOKING', id: b2, levelNumber: 1, decision: 'Rejected', reason: 'Dates clash' }));
  rec = (await call('u-admin', 'getBuiltRecord', { moduleId: 'X_BOOKING', id: b2 })).record;
  assert.deepEqual([rec.Status, rec.ApprovalRejected, rec.RejectionReason], ['Draft', true, 'Dates clash']);
  assert.deepEqual((await call('u-admin', 'getMyRejectedSubmissions', {})).map(r => [r.ModuleID, r.DocumentNumber, r.RejectionReason]), [['X_BOOKING', 'BK-26-000002', 'Dates clash']]);
  assert.match(await refused(call('u-admin', 'deleteBuiltRecord', { moduleId: 'X_BOOKING', id: b.id })), /still Draft is deleted/);
  ok(await call('u-admin', 'deleteBuiltRecord', { moduleId: 'X_BOOKING', id: b2 }));
  assert.equal((await firestore.collection('builtRecords').doc(b2).get()).exists, false);
  // A master is switched off, not deleted; then not offered for new links.
  ok(await call('u-admin', 'setBuiltActive', { moduleId: 'X_ROOM', id: r101, active: false }));
  assert.deepEqual((await call('u-admin', 'getBuiltLinkOptions', { moduleId: 'X_BOOKING', target: 'X_ROOM', companyId: 'C1' })).options.map(o => o.label), ['102 · Sea room']);
});
