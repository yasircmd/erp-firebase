// A customer's mobile (Customer Master's Phone) is unique per company
// (owner, 2026-10-16; docs/modules/UX_TIER3.md, E, decision 160). Numbers
// are compared on their digits, the last 9 of them, so "050 123 4567",
// "+971 50 123 4567" and "00971501234567" are the same number.
'use strict';

function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7) return ''; // not a phone number to compare
  return digits.slice(-9);
}

// The other active customer with the same number, of the same company or
// shared by all (a shared customer is in every company), or null.
function phoneClash(customers, phone, companyId, exceptId) {
  const key = phoneKey(phone);
  if (!key) return null;
  const id = Object.keys(customers || {}).find(cid => {
    const c = customers[cid] || {};
    return cid !== exceptId && c.Status !== 'Inactive' && phoneKey(c.Phone) === key &&
      (!companyId || !c.CompanyID || c.CompanyID === companyId);
  });
  return id ? Object.assign({ CustomerID: id }, customers[id]) : null;
}

const clashMessage = (phone, c) => 'The mobile number ' + phone + ' is already ' + (c.CustomerName || 'another customer') + '\'s' + (c.CustomerCode ? ' (' + c.CustomerCode + ')' : '') + ': each customer of a company has their own.';

module.exports = { phoneKey, phoneClash, clashMessage };
