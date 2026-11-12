// Module Builder, phase 5 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q489-Q492): built modules in the MIS report builder. A master's rows (all
// of its records, today); a document's by its date in the report's months
// and company, and its lines' second set; a built master's fields through a
// link (bookings grouped by room type); the rights (MIS and the module's own
// access); a saved builder report on a built module; a variant's revenue on
// Sales lines with its extra field.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.ok(r && r.success !== false, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const D = new Date().toISOString().slice(0, 10), M0 = D.slice(0, 7);
const lastMonth = (() => { const d = new Date(M0 + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const build = (dataset, spec, extra, uid) => call(uid || 'u-admin', 'runMisBuilder', Object.assign({ dataset, companyId: 'C1', month: M0, months: 1, spec }, extra || {}));

async function publish(def) {
  ok(await call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }));
  return ok(await call('u-admin', 'publishModuleDefinition', { id: def.id }));
}

test('built modules as data sets: rows by period and company, lines, a master\'s fields through a link, rights, a saved report; a variant\'s revenue', async () => {
  const f = baseFixture();
  f.customers = { K1: { CustomerCode: 'C-001', CustomerName: 'Example Guest LLC', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Rooms', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.permissions.X_ROOM = { access: ['Admin'], write: ['Admin'] };
  f.permissions.X_STAY = { access: ['Admin'], write: ['Admin'], void: ['Admin'] };
  f.permissions.X_RINV = { access: ['Admin'], draft: ['Admin'], post: ['Admin'], taxcode: ['Admin'] };
  await reset(f);
  await publish({ id: 'X_ROOM', label: 'Room', kind: 'master', fields: [{ key: 'roomType', label: 'Room type', type: 'choice', options: ['Single', 'Double'] }, { key: 'rate', label: 'Rate', type: 'amount' }] });
  await publish({ id: 'X_STAY', label: 'Stay', kind: 'document', numbering: { prefix: 'ST' }, fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER' }],
    lines: { enabled: true, label: 'Rooms', fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM' }, { key: 'nights', label: 'Nights', type: 'number' }, { key: 'amount', label: 'Amount', type: 'amount' }] },
    statuses: [{ name: 'Open' }, { name: 'Closed', final: true }] });
  await publish({ id: 'X_RINV', label: 'Room Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'RINV' }, fields: [{ key: 'room', label: 'Room', type: 'text' }] });

  const save = (mod, record) => call('u-admin', 'saveBuiltRecord', { moduleId: mod, record }).then(ok).then(r => r.id);
  const r101 = await save('X_ROOM', { CompanyID: 'C1', Code: '101', Name: 'Garden', Fields: { roomType: 'Double', rate: 400 } });
  const r102 = await save('X_ROOM', { CompanyID: 'C1', Code: '102', Name: 'Sea', Fields: { roomType: 'Single', rate: 300 } });
  const r103 = await save('X_ROOM', { CompanyID: 'C1', Code: '103', Name: 'Park', Fields: { roomType: 'Double', rate: 350 } });
  await save('X_STAY', { CompanyID: 'C1', Date: D, Fields: { guest: { id: 'K1' } }, Lines: [{ room: { id: r101 }, nights: 2, amount: 800 }, { room: { id: r102 }, nights: 1, amount: 300 }] });
  await save('X_STAY', { CompanyID: 'C1', Date: D, Fields: { guest: { id: 'K1' } }, Lines: [{ room: { id: r103 }, nights: 3, amount: 1050 }] });
  // Switched off after it was booked: its booking still counts.
  ok(await call('u-admin', 'setBuiltActive', { moduleId: 'X_ROOM', id: r103, active: false }));
  await save('X_STAY', { CompanyID: 'C1', Date: lastMonth, Fields: {}, Lines: [{ room: { id: r101 }, nights: 9, amount: 9999 }] });

  // The data sets offered: the built ones, a document's lines too; not a variant.
  const sets = (await call('u-admin', 'getMisDatasets', {})).datasets.map(d => d.id);
  assert.ok(['x:X_ROOM', 'x:X_STAY', 'xl:X_STAY'].every(id => sets.includes(id)) && !sets.some(id => /X_RINV/.test(id)), JSON.stringify(sets));
  // A master: every record, today, the switched-off one told apart.
  const rooms = await build('x:X_ROOM', { view: 'group', groupBy: ['f_roomType', 'active'], measures: [{ field: 'f_rate', agg: 'sum' }] });
  assert.deepEqual(rooms.rows, [['Double', 'Active', 400], ['Double', 'Off', 350], ['Single', 'Active', 300]]);
  // A document: this month's (not last month's), one row each with its lines' totals.
  const stays = await build('x:X_STAY', { view: 'group', groupBy: ['f_guest'], measures: [{ field: 't_amount', agg: 'sum' }, { field: 't_nights', agg: 'sum' }] });
  assert.deepEqual(stays.rows, [['C-001 · Example Guest LLC', 2150, 6]]);
  assert.deepEqual((await build('x:X_STAY', { view: 'group', groupBy: ['month'], measures: [{ field: 't_amount', agg: 'sum' }] }, { months: 2 })).rows.map(r => r[1]).sort((a, b) => a - b), [2150, 9999]);
  // Its lines: by the room's own type, through the link (Q491).
  const byType = await build('xl:X_STAY', { view: 'group', groupBy: ['l_room__roomType'], measures: [{ field: 'l_amount', agg: 'sum' }, { field: 'l_nights', agg: 'sum' }] });
  assert.deepEqual(byType.rows, [['Double', 1850, 5], ['Single', 300, 1]]);
  // Another company's: none.
  assert.equal((await build('x:X_STAY', { view: 'list', columns: ['number'] }, { companyId: 'C2' }, 'u-other').catch(e => ({ rows: [], err: e.message }))).rows.length, 0);

  // Rights: the module's own access.
  await rtdb.ref('permissions/MIS/access').set(['Admin', 'Viewer']);
  assert.ok(!(await call('u-viewer', 'getMisDatasets', {})).datasets.some(d => d.id === 'x:X_STAY'));
  assert.match(await refused(build('x:X_STAY', { view: 'list', columns: ['number'] }, {}, 'u-viewer')), /access to stay/i);

  // A saved builder report on a built module, run as a dashboard tile's rows.
  const saved = ok(await call('u-admin', 'saveMisReport', { name: 'Nights by room type', type: 'builder', companyId: 'C1', chart: 'bar', period: { kind: 'latest' },
    builder: { dataset: 'xl:X_STAY', months: 1, spec: { view: 'group', groupBy: ['l_room__roomType'], measures: [{ field: 'l_nights', agg: 'sum' }] } } }));
  const tile = await call('u-admin', 'runSavedMisBuilder', { id: saved.id || saved.reportId, month: M0 });
  assert.deepEqual(tile.result.rows, [['Double', 5], ['Single', 1]]);

  // Q492: a Room Invoice's revenue on Sales lines, its Variant and extra field.
  const inv = (fields, v) => call('u-admin', 'saveCustomerInvoiceDraft', Object.assign({ invoiceData: { InvoiceDate: D, Description: 'Stay', CompanyID: 'C1', CustomerID: 'K1', CostCenterID: 'CC1', SourceDeliveryNotes: [],
    DirectLines: [{ AccountCode: '4000', Amount: fields.amount, Description: 'Rooms', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } }, v ? { __variant: 'X_RINV', __variantFields: { room: fields.room } } : {}));
  const a = ok(await inv({ amount: 500, room: '101' }, true));
  const b = ok(await inv({ amount: 200 }, false));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: a.invoiceId, __variant: 'X_RINV' }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: b.invoiceId }));
  const byVariant = await build('sales', { view: 'group', groupBy: ['variant', 'v_X_RINV__room'], measures: [{ field: 'amount', agg: 'sum' }] });
  assert.deepEqual(byVariant.rows, [['(none)', '(none)', 200], ['Room Invoice', '101', 500]]);
});
