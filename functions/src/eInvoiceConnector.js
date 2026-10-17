// The one place an e-invoice leaves the ERP (docs/modules/E_INVOICING.md,
// decision 226). No Accredited Service Provider (ASP) is chosen yet, so
// nothing is sent: a ready e-invoice stays NotSent. When the ASP is chosen,
// its API is called here (with its credentials kept in Secret Manager, never
// in the database or the screens), returning the same fields:
//   { SendStatus: 'Sent' | 'Rejected' | 'NotSent', SendNote, AspReference }
'use strict';

const NAME = 'None (no ASP connected yet)';

async function send(record, settings) { // eslint-disable-line no-unused-vars
  return { SendStatus: 'NotSent', SendNote: 'Ready to send: no ASP is connected yet.', AspReference: '' };
}

module.exports = { NAME, send };
