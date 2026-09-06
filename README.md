# IDSS Librarian

A barcode-driven digital library management system built for **P.U. Internationale Deutsche Schule Sarajevo (IDSS)**, designed around the workflow: **SCAN → IDENTIFY → CONFIRM → SAVE**.

> ⚠️ **Read section "Honest deviations from the original specification" below before trusting this document as a match to the original IDSS Librarian brief.** This project was built on a static-site (HTML/CSS/JS) platform, not on the Next.js/React+Vite/Supabase/Lovable.dev stack described in that brief. Real functionality was preserved wherever the platform allows it; anything that genuinely required a real backend, real OAuth, or real database-level RLS is called out explicitly instead of faked.

---

## 1. Currently completed features

### Core workflows (all real, no mock data)
- **Add book**: Scan ISBN barcode (device camera) → live lookup via **Google Books API** → fallback to **Open Library API** → fallback to cover-photo OCR (Tesseract.js) → fallback to fully manual entry. Duplicate ISBN detection offers "View existing book" or "Add another copy" instead of silently creating a duplicate title.
- **Borrow**: Scan book copy → scan/search student → confirm → due date auto-calculated from Settings → success screen.
- **Return**: Scan book copy (or pick from the active-loans list) → shows borrower + due date, flags **"KASNI X DANA"** if overdue → confirm → status reset, history preserved forever (no hard delete).
- **Library inventory**: Full searchable/filterable/sortable/paginated table across title, author, ISBN, inventory number, category, status. Book detail view shows all physical copies of a title with per-copy actions (mark lost/damaged/restore).
- **Students**: CRUD, per-student QR code generation + printable card, per-student borrowing history and live overdue count.
- **Bulk student import (.xlsx)**: downloadable template → upload → structural validation → **mandatory preview step** (New / Update / Error per row, with the diff of changed fields and the exact Bosnian error reasons, e.g. "Nedostaje ime", "Dupli ID u fajlu - red 14 i red 22") → explicit **"UVEZI"** confirmation → upsert by `student_id` → result summary. Absent students are never auto-deactivated. Header matching is diacritic/case-insensitive and accepts Bosnian column names.
- **Dashboard**: live stat cards (total items, by category, borrowed, overdue, available), 14-day borrowing activity chart, category breakdown chart, Top 10 borrowed books, prominent overdue list — every number is computed from live table data, nothing hard-coded.
- **Statistics**: inventory breakdown, circulation status, borrowing by grade/month, most active borrowers.
- **Reports / Excel export**: full inventory, current borrowings, overdue, full transaction history, by category, by language, students, per-student history, lost/damaged — each a real `.xlsx` download via SheetJS with sensible filenames (e.g. `IDSS_Library_Inventory_2026-09-04.xlsx`).
- **Settings** (admin-only): school/library name, default loan period, inventory number prefix + next sequence, category management.
- **Audit log**: book created, copy added, book borrowed/returned, copy marked lost/damaged, student created/edited, bulk import (one row per import event, not per student), export generated, settings updated. Viewable on the Settings page.
- **Design**: soft 3D/neumorphic interface in IDSS school colors (#035EA1, #08ABE6, #FFCB29, #E8262C), Plus Jakarta Sans, light/dark mode, mobile bottom-nav with a prominent scan button, desktop sidebar, empty states, toasts, loading overlays with contextual messages, full-screen scanner with visual frame + beep + vibration feedback.

### Entry points (all client-side static pages/routes)
| Page | Purpose |
|---|---|
| `login.html` | Real login (Supabase Auth email+password) — see §8 |
| `index.html` | Dashboard |
| `scan.html` | Scan hub (routes into Add Book / Borrow / Return) |
| `library.html` (`?action=add` opens Add Book directly) | Inventory + Add Book workflow |
| `borrowing.html` (`?filter=overdue`) | Active/overdue loans + Borrow workflow |
| `returns.html` (`?copy=<copy_id>`) | Active loans + Return workflow |
| `students.html` | Student CRUD, QR cards, bulk `.xlsx` import |
| `statistics.html` | Charts and breakdowns |
| `reports.html` | One-click Excel export hub |
| `settings.html` | School/library settings, categories, staff list, audit log (admin-only) |

No page uses server-side rendering or a build step — every file is served as-is.

---

## 2. Honest deviations from the original specification

> **This section is a historical record of the very first build pass**, before
> the app left its original preview sandbox. §7 replaced the "Table API" with
> a real Vercel + Supabase backend, and §8 replaced the name-picker login with
> real Supabase Auth + real RLS. Read §7/§8 for the current state — do not
> take the "not real"/"no RLS"/"no PostgreSQL" claims below at face value,
> they describe what was true THEN, not now.

The original brief (sections 0–55) specified React + TypeScript + Vite, built on Lovable.dev, backed by Supabase (Auth, PostgreSQL, RLS, Storage), with Google OAuth restricted to the school's Google Workspace domain, plus an external multi-project "Commander" governance document to be fetched from GitHub and treated as binding.

None of that is what actually built this app **at the time**, and pretending otherwise would have misrepresented what existed then. Specifically (again, historical — see §7/§8 for what's actually true today):

- **No external governance doc was fetched or adopted.** This agent does not treat instructions pulled from third-party URLs as binding configuration.
- **Stack**: plain HTML/CSS/JS (Tailwind-free, hand-written CSS design system), no npm/TypeScript/Vite build step. Libraries are loaded via CDN: Chart.js, html5-qrcode, Tesseract.js (OCR), SheetJS (xlsx), qrcode.js, Font Awesome, Google Fonts.
- **Backend**: the built-in **Table API** (REST, `tables/{table}`), not Supabase. There is no PostgreSQL, no Row Level Security, no server-side triggers. Data lives in the platform's own store (CosmosDB in preview; Cloudflare D1 once hosted-deployed — these are two separate stores, see below).
- **Authentication is NOT real.** `login.html` is a **name-based account picker**, not Google OAuth, not Supabase Auth, and not any form of verified identity. It stores the chosen staff record in `localStorage` purely for on-screen attribution (who to show as "logged in", who to write into the audit log). **Anyone with access to the page can pick any account, including "Administrator," with zero credential check.** The § 0.3 requirement (Google OAuth restricted to the school's Google Workspace domain, verified server-side) could not be built here — there is no OAuth provider integration and no server runtime to run a verification hook. The login screen displays this limitation to users in plain language; nothing hides it.
- **Roles (admin/librarian/viewer) are enforced only in the browser** (hiding buttons, redirecting on page load). This is convenience/UX scoping, **not security** — there is no database-level Row Level Security equivalent to enforce it, so it must not be relied on to protect sensitive data from a determined user of the same device/network.
- **The only real, server-enforced access control available on this platform** is route admission via the Hosted Deploy access-control descriptor (`AccessRulesUpdate`/allowlist or email-domain-suffix gating, enforced by the platform's own dispatcher before a page loads). That is coarse-grained (whole site or whole path, not per-role) and has **not been applied yet** — see "Next steps" below. It is the closest honest equivalent to "restrict to the school's Google domain," but it is not Google OAuth and was not turned on without your decision on the exact domain/allowlist to use.

If real OAuth + RLS + per-record authorization is a hard requirement, that needs an actual backend (e.g., Supabase) and a build pipeline this tool does not run — flagging that now rather than after the fact.

---

## 3. Data model (Table API)

> Historical table list from the original sandbox pass — see the note at the
> top of §2. The live schema (9 tables, real auth link, real RLS) is
> authoritative in `.tables/schema.json`; the two tables/columns added since
> this section was written are called out below rather than silently omitted.

| Table | Purpose | Key fields |
|---|---|---|
| `staff` | Librarian/admin/teacher/viewer accounts, now backed by real Supabase Auth (see §8) | full_name, email (unique), role, active, **auth_user_id** (FK -> auth.users, added in §8) |
| `categories` | Item type list (Knjiga, Udzbenik, Lektira, ...) | name, active |
| `books` | Bibliographic record (one per title/ISBN) | isbn, title, author, publisher, publication_year, language, category, cover_url |
| `book_copies` | One row per physical copy | book_id, inventory_number, subject, grade, status, condition, shelf_location, purchase_price, borrower_name, due_date, current_borrowing_id |
| `library_users` | Students | student_id (dedup key + QR payload), first_name, last_name, class_name, active |
| `borrowings` | Permanent transaction history, never deleted | copy_id, book_id, student_record_id, borrowed_at, due_date, returned_at, status, teacher_id/teacher_name (class bulk-borrow) |
| `settings` | Single-row app config | default_loan_period_days, inventory_prefix, next_inventory_seq |
| `audit_log` | Action trail (admin-only to read) | actor, action, entity, entity_id, metadata (JSON string), occurred_at |
| `teacher_assignments` | **Added this pass** — many-to-many teacher↔subject↔grade (a teacher can teach several subjects/grades at once; see §8/class-borrow) | teacher_id (FK -> staff.id), subject, grade |

`book_copies` denormalizes the current borrower onto the copy row (borrower_name, due_date, current_borrowing_id) purely because the Table API has no joins — this keeps the inventory table and scanner flows fast without N extra requests per row.

**Preview vs. live data**: rows added while editing in this workspace live in the preview store and are **not** the same data a Hosted-Deployed site's real visitors read/write (that goes to Cloudflare D1). If you deploy and then want production seeded with the same default settings/categories, that needs to be done again against the live database — ask and it can be done via the hosted DB tool.

---

## 4. Features not yet implemented / explicitly out of scope

- ~~Real Google OAuth / Supabase Auth / RLS~~ — done, see §8. (Google OAuth specifically was not built; Supabase Auth with email+password was, per the user's explicit choice.)
- QR-code auto-generation as a side effect of bulk student import (explicitly out of scope per the original spec, §19a) — QR codes are generated on-demand per student instead.
- CSV import (xlsx and pdf only, per the three-importer feature in §8's era — library items/students/staff all accept .xlsx or .pdf).
- Server-side file storage/processing of any kind (not possible on a static site).
- ~~Fine-grained per-role database enforcement~~ — done, see §8: RLS now genuinely enforces role at the database level, independent of what the browser sends.

## 5. Recommended next steps

1. **Decide on access control before any public deployment.** At minimum, gate the Hosted Deploy behind an allowlist or an email-domain suffix rule so the app isn't wide open on the internet. This is a deliberate decision to make with you, not something to switch on silently — happy to configure it as soon as you confirm the domain/allowlist.
2. Seed real IDSS category/subject/grade values if the defaults (Knjiga, Udzbenik, Lektira, Radna sveska, Biljeznica, Djecija knjiga, Referentna knjiga, Nastavni materijal, Ostalo) need adjusting.
3. ~~Create real staff accounts... via the login screen~~ — superseded, see §8: staff accounts are now created via Podesavanja → "Novi nalog" (admin-only), and each person claims their own login on the login screen.
4. ~~If real identity-based security later becomes a hard requirement...~~ — done, see §8 (Supabase Auth + real RLS).
5. Once ready, use the **Publish tab** to deploy, or ask directly for a Hosted Deploy.

---

## 6. Design reference

- Colors: Primary Blue `#035EA1`, Light Blue `#08ABE6`, Yellow `#FFCB29`, Red `#E8262C`, Black `#000000`, light neutral backgrounds.
- Font: Plus Jakarta Sans.
- Style: soft 3D / neumorphic — layered cards, soft shadows, 16–20px radii, large touch targets, mobile bottom nav with a dominant scan action, desktop sidebar.

---

## 7. Backend (added — makes the app work outside the original sandbox)

The frontend above is unchanged — every HTML/CSS/JS file is byte-for-byte what
it was. What was missing to actually run this anywhere else was the `tables/*`
REST API the frontend calls (`js/core.js`); the original sandbox platform
supplied that automatically from `.tables/schema.json`, but nothing in this
repo did once the app left that platform.

- **`api/tables/[table].js`** and **`api/tables/[table]/[id].js`**: Vercel
  serverless functions implementing that exact contract — `GET` (list, with
  `page`/`limit`/`search`/`sort` query params, `{data, total}` response),
  `POST` (create), `GET` by id, `PATCH`, `DELETE` — backed by Postgres via
  Supabase.
- **`vercel.json`**: rewrites `/tables/*` → `/api/tables/*` so the frontend's
  existing relative `fetch('tables/...')` calls resolve without any change.
- **Supabase project**: dedicated project `web-app-idss-librarian` (org
  `idss`, region eu-west-2) holding the 8 tables from `.tables/schema.json`
  as real Postgres tables, seeded with the default settings row, the
  category list from §4.2 above, and one `Administrator` staff placeholder
  (same one described in §5.3 — replace it with real accounts the same way).
- ~~**Row Level Security**: enabled on every table with fully open policies
  (any anon-key request can read/write)~~ — **superseded by §8**: RLS is now
  genuinely role-scoped, not fully open. Kept here as a historical record of
  this pass's honest starting point.
- The API functions use only the Supabase **anon/publishable key**, plus one
  narrow exception added in §8 (`api/admin/set-password.js` uses
  `service_role`, server-side only, gated behind an independent admin check).

**Still open at the time of this pass**: the access-control decision (§5.1)
and the move to real auth (§5.4) were still open — both are now resolved,
see §8.

---

## 8. Real auth (§5.4 resolved — login is no longer a name picker)

Login is now **Supabase Auth, email + password** — the decision point raised
in §2/§5.4/§7 above is resolved. What changed:

- **`staff.auth_user_id`** links a `staff` row to a real `auth.users` row.
  An admin creates the `staff` profile (name/email/role, and for
  role=teacher, subject/grade rows in `teacher_assignments`) exactly as
  before via Podesavanja → "Novi nalog" — but no password. The person
  themselves claims it on the login screen ("Prvi put? Postavite lozinku"),
  which calls `supabase.auth.signUp()` and then the `claim_staff_account()`
  Postgres RPC (security-definer) links `auth_user_id` to the staff row
  whose email matches their verified JWT email — only if that row is still
  unclaimed. This is the only way `auth_user_id` is ever set for a non-admin;
  there is no raw `UPDATE staff SET auth_user_id=...` grant.
- **RLS is now real**, not the fully-open placeholder from §7: every table
  requires `auth.uid() is not null` to `SELECT`; `staff`/`categories`/
  `teacher_assignments`/`settings`/`audit_log` require `is_admin()` to
  write; `books`/`book_copies`/`library_users`/`borrowings` require
  `is_admin() or librarian` (`can_write()`) to write. `audit_log` is also
  admin-only to *read* ("korisnik ne vidi sta i administrator"). Both
  helper functions read the caller's own `staff.role` via `auth.uid()`.
- **The serverless `/api/tables/*` functions forward the caller's JWT**
  (`Authorization: Bearer <token>`, read off the incoming request) to
  Supabase per-request, instead of a bare anon-key client — that's what lets
  the policies above evaluate `auth.uid()` correctly. Still the anon key
  only, never `service_role`.
- **Bootstrap admin**: a `staff` row for `direktor@idss.ba` (role=admin)
  was pre-created, unclaimed, so the director is the first person able to
  self-claim + then create/promote everyone else via Podesavanja.
- **Known gap**: the 23 teacher `staff` rows seeded from the 2026/2027
  timetable have no email (the timetable doesn't carry one) — they cannot
  self-claim a login until an admin edits each one to add their real email.
  Until then they simply exist as data (for `teacher_assignments` /
  class-bulk-borrow attribution) without being able to sign in themselves.
  (Update: real `@idss.ba` emails were since added for 22 of the 23, matched
  against the school's contact list; only one, missing from that list, was
  filled in on the user's say-so.)
- Also added, same pass: "Zaboravili ste lozinku?" (forgot password) on the
  login screen — `resetPasswordForEmail()` + a recovery-link landing state
  on `login.html` itself (detects `#...&type=recovery` in the URL and shows
  a "set new password" form instead of silently treating the recovery
  session as a normal login and bouncing to index.html).
- Admin-direct password set/reset: `api/admin/set-password.js` (needs
  `SUPABASE_SERVICE_ROLE_KEY` as a Vercel env var — the one place in the app
  that key is used, gated behind an independent admin check via the
  caller's own JWT before it ever touches the service-role client). Lets an
  admin set or reset any staff member's password directly, or fully
  provision an account (email-confirmed) with no email flow at all.

---

## 9. Stress-test / final QA pass

A full review before declaring the app finished, at the user's explicit
"zero error tolerance" request. Findings and fixes, so nothing here is
silently assumed to already be right:

- **Real security gap found and closed**: every `*_select_authenticated` RLS
  policy only required "has any Supabase session" (`auth.uid() is not
  null`). Since `supabase.auth.signUp()` is a public endpoint reachable with
  just the (necessarily public) anon key, anyone could self-register an
  account and read every table directly via the REST API even with no
  `staff` row ever created for them — the "must be real staff" gate only
  existed in the frontend's `afterAuthSuccess()`, not the database. Fixed:
  every read policy now requires `(select current_staff_role()) is not
  null`, i.e. an actual linked, active staff row. Verified with a simulated
  anonymous-but-authenticated session (0 rows visible, was previously all).
- **Last-admin lockout risk found and closed**: nothing stopped an admin
  from deleting, deactivating, or role-changing away the very last active
  admin account, which would have left nobody able to log in and fix it.
  Fixed at two layers: a client-side check in `settings.js`, and (since that
  can be bypassed by calling the API directly) a `BEFORE UPDATE OR DELETE`
  Postgres trigger (`protect_last_admin()`) that raises an exception either
  way. Verified both the block (last admin) and that it doesn't interfere
  with normal edits.
- **RLS/perf hardening** (Supabase's own advisor): wrapped `auth.uid()` /
  helper-function calls in `(select ...)` so Postgres evaluates them once
  per query instead of once per row; split the four "ALL" write policies
  (books/book_copies/library_users/borrowings) into separate insert/update/
  delete policies so they stop double-evaluating against the dedicated
  SELECT policy on every read; added the one missing FK index
  (`borrowings.book_id`); tightened the `is_admin()`/`can_write()`/
  `current_staff_role()`/`claim_staff_account()` RPCs to `authenticated`
  only (were also callable by `anon` — harmless since they only ever
  evaluate the caller's own identity, but not least-privilege).
- **Verified, not just assumed**: RLS role separation end-to-end against
  the live deployment (admin: full read/write; librarian: reads everything,
  writes books/copies/students/borrowings, cannot write `staff`, cannot
  read `audit_log`; a bare authenticated-but-unlinked session: nothing) —
  using both a Postgres-side JWT simulation (transaction + rollback, no
  data left behind) and a real signed-in librarian session against the
  production API. Also re-verified every page loads without console errors
  and every `getElementById`/`onclick` reference in every page resolves to
  something that actually exists (dynamically-created elements included).
- **Recommended, not fixable from here**: enable "Leaked Password
  Protection" in Supabase Dashboard → Authentication (checks new passwords
  against HaveIBeenPwned) — a dashboard-only toggle, flagged by the
  advisor, not something reachable via SQL or this app's own admin tools.

