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

The original brief (sections 0–55) specified React + TypeScript + Vite, built on Lovable.dev, backed by Supabase (Auth, PostgreSQL, RLS, Storage), with Google OAuth restricted to the school's Google Workspace domain, plus an external multi-project "Commander" governance document to be fetched from GitHub and treated as binding.

None of that is what actually built this app, and pretending otherwise would misrepresent what you have. Specifically:

- **No external governance doc was fetched or adopted.** This agent does not treat instructions pulled from third-party URLs as binding configuration.
- **Stack**: plain HTML/CSS/JS (Tailwind-free, hand-written CSS design system), no npm/TypeScript/Vite build step. Libraries are loaded via CDN: Chart.js, html5-qrcode, Tesseract.js (OCR), SheetJS (xlsx), qrcode.js, Font Awesome, Google Fonts.
- **Backend**: the built-in **Table API** (REST, `tables/{table}`), not Supabase. There is no PostgreSQL, no Row Level Security, no server-side triggers. Data lives in the platform's own store (CosmosDB in preview; Cloudflare D1 once hosted-deployed — these are two separate stores, see below).
- **Authentication is NOT real.** `login.html` is a **name-based account picker**, not Google OAuth, not Supabase Auth, and not any form of verified identity. It stores the chosen staff record in `localStorage` purely for on-screen attribution (who to show as "logged in", who to write into the audit log). **Anyone with access to the page can pick any account, including "Administrator," with zero credential check.** The § 0.3 requirement (Google OAuth restricted to the school's Google Workspace domain, verified server-side) could not be built here — there is no OAuth provider integration and no server runtime to run a verification hook. The login screen displays this limitation to users in plain language; nothing hides it.
- **Roles (admin/librarian/viewer) are enforced only in the browser** (hiding buttons, redirecting on page load). This is convenience/UX scoping, **not security** — there is no database-level Row Level Security equivalent to enforce it, so it must not be relied on to protect sensitive data from a determined user of the same device/network.
- **The only real, server-enforced access control available on this platform** is route admission via the Hosted Deploy access-control descriptor (`AccessRulesUpdate`/allowlist or email-domain-suffix gating, enforced by the platform's own dispatcher before a page loads). That is coarse-grained (whole site or whole path, not per-role) and has **not been applied yet** — see "Next steps" below. It is the closest honest equivalent to "restrict to the school's Google domain," but it is not Google OAuth and was not turned on without your decision on the exact domain/allowlist to use.

If real OAuth + RLS + per-record authorization is a hard requirement, that needs an actual backend (e.g., Supabase) and a build pipeline this tool does not run — flagging that now rather than after the fact.

---

## 3. Data model (Table API)

| Table | Purpose | Key fields |
|---|---|---|
| `staff` | Librarian/admin/viewer accounts (name-based, not real auth) | full_name, email, role, active |
| `categories` | Item type list (Knjiga, Udzbenik, Lektira, ...) | name, active |
| `books` | Bibliographic record (one per title/ISBN) | isbn, title, author, publisher, publication_year, language, category, cover_url |
| `book_copies` | One row per physical copy | book_id, inventory_number, status, condition, shelf_location, borrower_name, due_date, current_borrowing_id |
| `library_users` | Students | student_id (dedup key + QR payload), first_name, last_name, class_name, active |
| `borrowings` | Permanent transaction history, never deleted | copy_id, book_id, student_record_id, borrowed_at, due_date, returned_at, status |
| `settings` | Single-row app config | default_loan_period_days, inventory_prefix, next_inventory_seq |
| `audit_log` | Action trail | actor, action, entity, entity_id, metadata (JSON string), occurred_at |

`book_copies` denormalizes the current borrower onto the copy row (borrower_name, due_date, current_borrowing_id) purely because the Table API has no joins — this keeps the inventory table and scanner flows fast without N extra requests per row.

**Preview vs. live data**: rows added while editing in this workspace live in the preview store and are **not** the same data a Hosted-Deployed site's real visitors read/write (that goes to Cloudflare D1). If you deploy and then want production seeded with the same default settings/categories, that needs to be done again against the live database — ask and it can be done via the hosted DB tool.

---

## 4. Features not yet implemented / explicitly out of scope

- Real Google OAuth / Supabase Auth / RLS (see section 2 above — needs a real backend).
- QR-code auto-generation as a side effect of bulk student import (explicitly out of scope per the original spec, §19a) — QR codes are generated on-demand per student instead.
- CSV import (xlsx only, per spec).
- Server-side file storage/processing of any kind (not possible on a static site).
- Fine-grained per-role database enforcement (e.g. a "librarian" truly being unable to touch data behind the API, no matter what the browser sends) — the Table API itself is not role-aware.

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
- **Row Level Security**: enabled on every table with fully open policies
  (any anon-key request can read/write). This is a deliberate, honest match
  to the app's actual security model already documented in §2 above — there
  is still no server-side identity to scope RLS against, since login remains
  a name picker, not real auth. Locking this down further requires solving
  §5.1/§5.4 (real auth) first; doing per-role RLS without real auth would
  only look secure, not be secure.
- The API functions use only the Supabase **anon/publishable key** (never
  the `service_role` key), consistent with the point above.

**Still open, unchanged from §5**: the access-control decision (§5.1) and
the move to real auth (§5.4) are still yours to make, not something this
pass invented an answer for.

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

