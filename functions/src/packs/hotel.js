// The Hotel pack (MODULE_BUILDER.md, phase 6, Q494): rooms on a board,
// bookings on a calendar (no room booked twice), nights and amount worked
// out, check-out to a Room Invoice (a variant of Customer Invoice), table
// orders billed with their items. Taxes such as a tourism or municipality
// charge are the client's own components in Tax Configuration (Q496).
'use strict';
const S = (name, extra) => Object.assign({ name }, extra || {});

const definitions = [
  { id: 'X_HROOM', label: 'Room', kind: 'master', description: 'The hotel\'s rooms: type, floor, rate and housekeeping state.',
    fields: [
      { key: 'roomType', label: 'Room type', type: 'choice', options: ['Single', 'Double', 'Twin', 'Suite'], required: true },
      { key: 'floor', label: 'Floor', type: 'number' },
      { key: 'rate', label: 'Rate per night', type: 'amount' },
      { key: 'housekeeping', label: 'Housekeeping', type: 'choice', options: ['Clean', 'Cleaning', 'Out of order'] }],
    board: { enabled: true, stateField: 'housekeeping' }, listColumns: ['roomType', 'floor', 'rate'] },
  { id: 'X_HRINV', label: 'Room Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'HRINV' },
    labels: { customer: 'Guest' }, defaults: { description: 'Room charges' },
    fields: [{ key: 'room', label: 'Room', type: 'text' }, { key: 'nights', label: 'Nights', type: 'number' }] },
  { id: 'X_HBOOK', label: 'Booking', kind: 'document', numbering: { prefix: 'HB' }, description: 'A guest\'s stay in a room, from arrival to departure.',
    fields: [
      { key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER', required: true },
      { key: 'room', label: 'Room', type: 'link', target: 'X_HROOM', required: true },
      { key: 'arrive', label: 'Arrival', type: 'date', required: true },
      { key: 'depart', label: 'Departure', type: 'date', required: true },
      { key: 'adults', label: 'Adults', type: 'number' },
      { key: 'rate', label: 'Rate per night', type: 'amount', required: true },
      { key: 'nights', label: 'Nights', type: 'calc', op: 'days', of: ['arrive', 'depart'] },
      { key: 'amount', label: 'Room charges', type: 'calc', op: 'product', of: ['nights', 'rate'] },
      { key: 'notes', label: 'Notes', type: 'longtext' }],
    statuses: [S('Booked'), S('Checked in'), S('Checked out'), S('Cancelled', { final: true })],
    schedule: { enabled: true, resourceField: 'room', startField: 'arrive', endField: 'depart', endIsFree: true, holds: [{ status: 'Booked', state: 'Booked' }, { status: 'Checked in', state: 'Occupied' }] },
    actions: [{ key: 'invoice', label: 'Room Invoice', target: 'CUSTOMERINVOICE', statuses: ['Checked out'], party: 'guest', amount: 'amount',
      description: 'Room {room}, {nights} night(s) from {arrive}', variant: 'X_HRINV', variantFields: { room: 'room', nights: 'nights' } }],
    listColumns: ['guest', 'room', 'arrive', 'depart', 'amount'] },
  { id: 'X_HTORD', label: 'Table order', kind: 'document', numbering: { prefix: 'TO' }, description: 'A restaurant table\'s order, billed with its items.',
    fields: [
      { key: 'table', label: 'Table', type: 'text', required: true },
      { key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER', required: true },
      { key: 'store', label: 'Kitchen store', type: 'link', target: 'WAREHOUSE' }],
    lines: { enabled: true, label: 'Items', fields: [
      { key: 'item', label: 'Item', type: 'link', target: 'ITEM', required: true },
      { key: 'qty', label: 'Qty', type: 'number', required: true },
      { key: 'price', label: 'Price', type: 'amount' },
      { key: 'amount', label: 'Amount', type: 'calc', op: 'product', of: ['qty', 'price'] }] },
    statuses: [S('Open'), S('Served'), S('Void', { final: true })],
    actions: [{ key: 'bill', label: 'Bill the guest', target: 'CUSTOMERINVOICE', statuses: ['Served'], party: 'guest', source: 'lines', kind: 'item', item: 'item', quantity: 'qty', price: 'price', warehouse: 'store', description: 'Table {table}' }],
    listColumns: ['table', 'guest'] }
];

const pack = {
  id: 'P_HOTEL', label: 'Hotel', help: 'pack-hotel',
  description: 'Rooms and their housekeeping board, bookings on a calendar with no double booking, Room Invoices at check-out, restaurant table orders.',
  modules: ['X_HROOM', 'X_HBOOK', 'X_HRINV', 'X_HTORD'],
  menu: { folder: 'Hotel', items: [{ module: 'X_HBOOK', text: 'Bookings' }, { module: 'X_HROOM', text: 'Rooms' }, { module: 'X_HRINV', text: 'Room Invoices' }, { module: 'X_HTORD', text: 'Table orders' }] },
  reports: [
    { key: 'nightsByType', name: 'Nights by room type', dataset: 'x:X_HBOOK', months: 1, spec: { view: 'group', groupBy: ['f_room__roomType'], measures: [{ field: 'f_nights', agg: 'sum' }, { field: 'f_amount', agg: 'sum' }] }, tile: 'chart' },
    { key: 'byRoom', name: 'Room charges by room', dataset: 'x:X_HBOOK', months: 1, spec: { view: 'group', groupBy: ['f_room'], measures: [{ field: 'f_amount', agg: 'sum' }] }, tile: 'top' },
    { key: 'invoiced', name: 'Room Invoices against other sales', dataset: 'sales', months: 1, spec: { view: 'group', groupBy: ['variant'], measures: [{ field: 'amount', agg: 'sum' }] } }],
  checklist: [
    { key: 'rooms', kind: 'manual', text: 'Add your rooms with their type, floor and rate (Hotel → Rooms).' },
    { key: 'bookBooks', kind: 'setup', module: 'X_HBOOK', text: 'Set the sales type and the room revenue account for Room Invoices (Bookings → Setup).' },
    { key: 'orderBooks', kind: 'setup', module: 'X_HTORD', text: 'Set the sales type for table orders (Table orders → Setup), and give your menu items their prices.' },
    { key: 'tax', kind: 'tax', text: 'Add your tourism, municipality or service charges as tax components in Tax Configuration, and give the room revenue its tax code.' },
    { key: 'roles', kind: 'rights', text: 'Give the front desk and the restaurant their rights in Roles & Permissions.' }]
};

module.exports = { pack, definitions };
