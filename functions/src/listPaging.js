// Gmail-style paging for the document lists (owner, 2026-10-02;
// docs/modules/LIST_PAGING.md). A list shows the newest 100; "Load next
// 100" continues after the last one shown. Search and filters run here,
// over every entry the user can see, and return their matches 100 at a
// time with the total number of matches.
//
// The order is newest created first (CreatedAt, then the entry's id, both
// descending), as the lists' "most recent 100" always were. `next` is an
// opaque marker for the last entry returned: the next page starts
// strictly after it, so entries added meanwhile can't shift a page or
// repeat one.
const PAGE_SIZE = 100;

// What a screen sends as `page` (all optional): search, from, to (dates,
// yyyy-mm-dd, inclusive), the module's equality filters (e.g. CompanyID,
// Status), `after` (a previous `next`), or `id` (that one entry only).
function normalize(page, spec) {
  const p = page || {};
  const str = v => String(v == null ? '' : v).trim();
  const equals = {};
  (spec.equals || []).forEach(k => { if (str(p[k])) equals[k] = str(p[k]); });
  return {
    search: str(p.search).toLowerCase(),
    from: str(p.from),
    to: str(p.to),
    equals,
    after: str(p.after),
    id: str(p.id)
  };
}

const isFiltered = req => Boolean(req.search || req.from || req.to || Object.keys(req.equals).length);

const createdOf = e => String((e && e.CreatedAt) || '');
// Newest first: CreatedAt descending, then id descending (Firestore's own
// order for equal CreatedAt under a descending sort).
function compareNewestFirst(spec) {
  return (a, b) => createdOf(b).localeCompare(createdOf(a)) ||
    (String(b[spec.idField]) < String(a[spec.idField]) ? -1 : String(b[spec.idField]) > String(a[spec.idField]) ? 1 : 0);
}

const cursorOf = (e, spec) => JSON.stringify([createdOf(e), String(e[spec.idField])]);
function parseCursor(after) {
  try {
    const c = JSON.parse(after);
    if (Array.isArray(c) && c.length === 2) return [String(c[0]), String(c[1])];
  } catch (e) { /* not a marker: start from the top */ }
  return null;
}
// Whether `e` comes strictly after the cursor in newest-first order.
function isAfter(e, cursor, spec) {
  const c = createdOf(e);
  if (c !== cursor[0]) return c < cursor[0];
  return String(e[spec.idField]) < cursor[1];
}

function matcher(req, spec) {
  return e => {
    for (const k of Object.keys(req.equals)) if (String(e[k] == null ? '' : e[k]) !== req.equals[k]) return false;
    const date = String(e[spec.dateField] || '');
    if (req.from && date < req.from) return false;
    if (req.to && date > req.to) return false;
    if (req.search && !String(spec.text(e) || '').toLowerCase().includes(req.search)) return false;
    return true;
  };
}

// One page of `all` (every entry the user may see, in any order).
function pageOf(all, page, spec) {
  const req = normalize(page, spec);
  if (req.id) {
    // A report's drill-down may pass the posted GL entry's id instead
    // (spec.idAlso, e.g. LinkedJVID), as the screens' own lookups allow.
    const one = all.filter(e => [spec.idField].concat(spec.idAlso || []).some(k => e[k] != null && String(e[k]) === req.id));
    return { entries: one, total: one.length, next: '', filtered: true };
  }
  // A user with one company has it filled into the company filter (the
  // shell's single-company default): a filter that narrows nothing is no
  // filter, so the list still reads as the list, not as "matches".
  if (req.equals.CompanyID && all.every(e => e.CompanyID === req.equals.CompanyID)) delete req.equals.CompanyID;
  const matching = all.filter(matcher(req, spec)).sort(compareNewestFirst(spec));
  const cursor = req.after ? parseCursor(req.after) : null;
  const rest = cursor ? matching.filter(e => isAfter(e, cursor, spec)) : matching;
  const entries = rest.slice(0, PAGE_SIZE);
  const next = rest.length > PAGE_SIZE ? cursorOf(entries[entries.length - 1], spec) : '';
  return { entries, total: matching.length, next, filtered: isFiltered(req) };
}

module.exports = { PAGE_SIZE, normalize, isFiltered, compareNewestFirst, cursorOf, parseCursor, isAfter, pageOf };
