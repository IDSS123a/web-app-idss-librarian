// Shared Supabase client + table-contract config for the /api/tables/* functions.
// Uses the anon/publishable key only (never the service_role key) — RLS on every
// table is deliberately open (see README §2: this app has no server-side identity
// to enforce per-role rules against, so the DB policy mirrors that honestly
// instead of pretending to be more secure than the app actually is).
const { createClient } = require('@supabase/supabase-js');

// Defaults point at the dedicated `web-app-idss-librarian` Supabase project
// (org "idss", ref lhsdqicltpcibemcwtaj). This is the anon/public key — by
// design safe to ship in code (Supabase's own model: RLS is the boundary,
// not key secrecy) — but both can be overridden via Vercel env vars without
// a code change if the project ever moves.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lhsdqicltpcibemcwtaj.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoc2RxaWNsdHBjaWJlbWN3dGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDkwMTcsImV4cCI6MjEwNDEyNTAxN30.CAFtTYK82yfY0pHSpU5PWCqVeQ1fnnkJP4PccSAtULU';

// `accessToken` is the calling user's Supabase session JWT (from the
// frontend's Authorization header) -- forwarding it is what lets Postgres
// RLS policies evaluate auth.uid()/auth.jwt() for that user. Without it,
// every request is anonymous and RLS (deliberately, since real accounts
// went live) rejects everything but a handful of public-read policies.
function getClient(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
  });
}

// Pulls the bearer token out of an incoming Vercel request, if present.
function getAccessToken(req) {
  const header = req.headers && req.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1] : null;
}

// Table -> text columns eligible for the free-text `search` query param.
// Mirrors .tables/schema.json field types (text / rich_text columns only —
// numbers, booleans and dates are not substring-searched).
const SEARCHABLE_COLUMNS = {
  staff: ['full_name', 'email', 'role'],
  categories: ['name'],
  books: ['isbn', 'title', 'subtitle', 'author', 'publisher', 'language', 'category'],
  book_copies: ['inventory_number', 'subject', 'grade', 'shelf_location', 'notes', 'borrower_name', 'borrower_student_id'],
  library_users: ['student_id', 'first_name', 'last_name', 'class_name', 'email'],
  borrowings: ['book_title', 'inventory_number', 'student_id', 'student_name', 'student_class', 'librarian_borrowed', 'librarian_returned'],
  settings: ['school_name', 'library_name', 'inventory_prefix'],
  audit_log: ['actor', 'action', 'entity', 'entity_id'],
  teacher_assignments: ['subject', 'grade']
};

const KNOWN_TABLES = Object.keys(SEARCHABLE_COLUMNS);

// The frontend was written against the original Table API, which silently
// accepted '' for date/number columns (e.g. `returned_at: ''` on an active
// borrowing). Postgres rejects '' for timestamptz/numeric columns outright
// ("invalid input syntax"), so every insert/update normalizes '' -> null
// first. Safe for text columns too: the frontend already treats '' and null
// identically (IDSS.fmtDate, `|| ''` fallbacks, etc. all treat both as empty).
function nullifyEmptyStrings(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    out[k] = v === '' ? null : v;
  }
  return out;
}

module.exports = { getClient, getAccessToken, SEARCHABLE_COLUMNS, KNOWN_TABLES, nullifyEmptyStrings };
