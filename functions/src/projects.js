// Projects (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md,
// decisions 219-224). New development, hand-written.
//
// A project is an Organizational Unit of type Project (patch projects in
// tools/legacy-port), shared or one company's like the others, with an
// optional customer and start / end dates. It is Active or Closed: a closed
// project takes no new postings (decision 221); its reversals still post.
//
//   orgUnits/{id} { Type: 'Project', Code, Name, CompanyID, Status, CustomerID, StartDate, EndDate }
'use strict';
const { rtdb } = require('./firebaseAdmin');

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 80);

// The fields a unit saves beyond the common ones (saveOrgUnit, patch
// projects): a project's customer and dates. Throws Error.
async function projectFields(type, unitData, companyId, status) {
  if (type !== 'Project') {
    if (status === 'Closed') throw new Error('Only a project is Closed; other units are Active or Inactive.');
    return type === 'Warehouse' ? warehouseFields(unitData, companyId) : {};
  }
  if (!['Active', 'Closed', 'Inactive'].includes(status)) throw new Error('A project is Active or Closed.');
  const d = unitData || {};
  const customerId = text(d.CustomerID);
  if (customerId) {
    const c = (await rtdb.ref('customers/' + customerId).get()).val();
    if (!c) throw new Error('Choose a customer of Customer Master for the project.');
    if (companyId && c.CompanyID && c.CompanyID !== companyId) throw new Error('The project\'s customer belongs to another company.');
  }
  const start = text(d.StartDate, 10), end = text(d.EndDate, 10);
  if (start && !isDate(start)) throw new Error('Enter the project\'s start date as a date.');
  if (end && !isDate(end)) throw new Error('Enter the project\'s end date as a date.');
  if (start && end && end < start) throw new Error('The project ends before it starts.');
  return { CustomerID: customerId, StartDate: start, EndDate: end };
}

// A warehouse's default cost center (owner, 2026-11-13; docs/modules/UX4.md
// item 4, Q502): an inventory entry takes it when its warehouse is chosen,
// still changeable, and the server uses it when the entry sends none. An
// active cost center of the warehouse's company, or a shared one (a shared
// warehouse: shared cost centers only). Throws Error.
async function warehouseFields(unitData, companyId) {
  const id = text((unitData || {}).DefaultCostCenterID);
  if (!id) return { DefaultCostCenterID: '' };
  const cc = (await rtdb.ref('orgUnits/' + id).get()).val();
  if (!cc || cc.Type !== 'CostCenter') throw new Error('Choose a cost center of Organizational Units as the warehouse\'s default.');
  if (cc.Status !== 'Active') throw new Error('The default cost center ' + (cc.Code || '') + ' is not active.');
  if (cc.CompanyID && cc.CompanyID !== companyId) throw new Error('The default cost center ' + (cc.Code || '') + ' belongs to another company.');
  return { DefaultCostCenterID: id };
}

// Every project a set of GL lines names exists, is the company's (or
// shared), and takes postings (not Closed or Inactive). Throws Error.
async function assertProjects(lines, companyId) {
  const named = (lines || []).map((l, i) => ({ id: String(l.ProjectID || '').trim(), n: i + 1 })).filter(x => x.id);
  if (!named.length) return;
  const units = (await rtdb.ref('orgUnits').get()).val() || {};
  named.forEach(({ id, n }) => {
    const u = units[id];
    if (!u || u.Type !== 'Project') throw new Error('Line ' + n + ': the project is not found.');
    if (u.CompanyID && u.CompanyID !== companyId) throw new Error('Line ' + n + ': project ' + u.Code + ' belongs to another company.');
    if (u.Status !== 'Active') throw new Error('Line ' + n + ': project ' + u.Code + ' is ' + String(u.Status || 'closed').toLowerCase() + ': it takes no new postings.');
  });
}

// A document's project on each of its GL lines (Customer / Vendor Invoice,
// patch projects): an account whose rule is Not used drops it again. A line
// with its own project keeps it (owner, 2026-11-03, Q388: the header is the
// lines' default, a line may differ).
const linesWithProject = (lines, projectId) => (projectId ? lines.map(l => Object.assign({}, l, { ProjectID: l.ProjectID || projectId })) : lines);

// A document's header project, checked when the document is saved (owner,
// 2026-11-03, Q387): '' or a project the company may use, as assertProjects
// checks a line's. Throws Error.
async function documentProject(projectId, companyId) {
  const id = String(projectId || '').trim().slice(0, 80);
  if (!id) return '';
  try { await assertProjects([{ ProjectID: id }], companyId); } catch (e) { throw new Error(e.message.replace(/^Line 1: the project/, 'The project').replace(/^Line 1: project/, 'Project')); }
  return id;
}

module.exports = { projectFields, assertProjects, linesWithProject, documentProject };
