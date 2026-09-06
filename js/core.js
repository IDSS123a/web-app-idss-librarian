/* ============================================================
   IDSS Librarian — Core utilities
   Table API wrapper, session/attribution, toast, loading, audit log
   ============================================================ */

const IDSS = (() => {

  // ---------- Generic Table API wrapper ----------
  // Every call attaches the current Supabase session's access token (if any)
  // so the serverless /api/tables/* proxy can forward it to Postgres and let
  // RLS evaluate auth.uid()/auth.jwt() for the real signed-in user.
  function authHeaders(extra = {}) {
    return _accessToken ? Object.assign({}, extra, { Authorization: `Bearer ${_accessToken}` }) : extra;
  }

  async function apiList(table, { page = 1, limit = 100, search = '', sort = '' } = {}) {
    const params = new URLSearchParams({ page, limit });
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    const res = await fetch(`tables/${table}?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Neuspjelo dohvatanje podataka (${table})`);
    return res.json();
  }

  async function apiListAll(table, extra = {}) {
    // Paginate through everything (careful use — for admin-side aggregate views only)
    let page = 1;
    const limit = 200;
    let all = [];
    while (true) {
      const res = await apiList(table, { page, limit, ...extra });
      all = all.concat(res.data || []);
      if (!res.data || res.data.length < limit || all.length >= (res.total || all.length)) break;
      page++;
      if (page > 100) break; // safety valve
    }
    return all;
  }

  async function apiGet(table, id) {
    const res = await fetch(`tables/${table}/${id}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Zapis nije pronadjen');
    return res.json();
  }

  async function apiCreate(table, data) {
    const res = await fetch(`tables/${table}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Neuspjelo cuvanje podataka');
    return res.json();
  }

  async function apiUpdate(table, id, data) {
    const res = await fetch(`tables/${table}/${id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Neuspjelo azuriranje podataka');
    return res.json();
  }

  async function apiDelete(table, id) {
    const res = await fetch(`tables/${table}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok && res.status !== 204) throw new Error('Neuspjelo brisanje');
    return true;
  }

  // ---------- IDs ----------
  function uid(prefix = '') {
    const rnd = Math.random().toString(36).slice(2, 10);
    const t = Date.now().toString(36);
    return `${prefix}${t}${rnd}`;
  }

  // ---------- Session / auth (real Supabase Auth — email+password) ----------
  // Public project URL + anon/publishable key: safe to ship in client code by
  // Supabase's own security model (RLS is the real boundary, not key secrecy).
  // Same values as the fallback in api/_supabase.js.
  const SUPABASE_URL = 'https://lhsdqicltpcibemcwtaj.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoc2RxaWNsdHBjaWJlbWN3dGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDkwMTcsImV4cCI6MjEwNDEyNTAxN30.CAFtTYK82yfY0pHSpU5PWCqVeQ1fnnkJP4PccSAtULU';

  let _sbClient = null;
  function getAuthClient() {
    if (!_sbClient) {
      if (typeof window.supabase === 'undefined') throw new Error('Supabase JS SDK nije ucitan (provjeri <script> tag na stranici).');
      _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _sbClient;
  }

  let _accessToken = null;   // current session JWT, attached to every tables/* fetch
  let _staffProfile = null;  // the `staff` row linked to the signed-in auth user
  let _authReady = false;    // true once initAuthSession() has resolved at least once

  // Reads the current Supabase session (if any) and loads the linked `staff`
  // profile (matched by auth_user_id). No linked/active staff row -> treated
  // as "not signed in" for this app, even if the Supabase session is valid,
  // since an app role is required for every page.
  async function initAuthSession() {
    const client = getAuthClient();
    const { data: { session } } = await client.auth.getSession();
    _accessToken = session ? session.access_token : null;
    if (!session) { _staffProfile = null; _authReady = true; return null; }

    const { data: staffRow } = await client.from('staff').select('*')
      .eq('auth_user_id', session.user.id).eq('active', true).maybeSingle();
    _staffProfile = staffRow || null;
    _authReady = true;

    if (!_authStateSubscribed) {
      _authStateSubscribed = true;
      client.auth.onAuthStateChange((_event, sess) => { _accessToken = sess ? sess.access_token : null; });
    }
    return _staffProfile;
  }
  let _authStateSubscribed = false;

  // Synchronous read of the cached staff profile — valid once requireSession()
  // (called by shell.js's renderShell, awaited by every page) has resolved.
  function getSession() { return _staffProfile; }

  async function clearSession() {
    _staffProfile = null; _accessToken = null;
    try { await getAuthClient().auth.signOut(); } catch (e) { /* best-effort */ }
  }

  async function requireSession() {
    if (!_authReady) await initAuthSession();
    if (!_staffProfile) {
      window.location.href = 'login.html';
      return null;
    }
    return _staffProfile;
  }

  function hasRole(...roles) {
    const s = getSession();
    return !!s && roles.includes(s.role);
  }

  // Exposed so pages can call non-`tables/*` API endpoints (e.g. admin
  // password-management) with the same bearer token apiList/etc. use.
  function getAccessToken() { return _accessToken; }

  // ---------- Toasts ----------
  function ensureToastRoot() {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function toast(message, type = 'info', duration = 3800) {
    const root = ensureToastRoot();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
    el.innerHTML = `<i class="fa-solid ${icon}" style="margin-top:2px;"></i><span>${message}</span>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 250);
    }, duration);
  }

  // ---------- Loading overlay ----------
  function ensureLoadingRoot() {
    let root = document.getElementById('loading-overlay');
    if (!root) {
      root = document.createElement('div');
      root.id = 'loading-overlay';
      root.innerHTML = `<div class="spinner"></div><div class="loading-msg" id="loading-msg-text">Ucitavanje...</div>`;
      document.body.appendChild(root);
    }
    return root;
  }

  function showLoading(message = 'Ucitavanje...') {
    const root = ensureLoadingRoot();
    document.getElementById('loading-msg-text').textContent = message;
    root.classList.add('show');
  }

  function hideLoading() {
    const root = document.getElementById('loading-overlay');
    if (root) root.classList.remove('show');
  }

  // ---------- Audit log ----------
  async function logAudit(action, entity, entityId, metadata = {}) {
    const s = getSession();
    try {
      await apiCreate('audit_log', {
        id: uid('audit-'),
        actor: s ? `${s.full_name} (${s.role})` : 'unknown',
        action, entity, entity_id: entityId || '',
        metadata: JSON.stringify(metadata),
        occurred_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Audit log failed (non-blocking):', e);
    }
  }

  // ---------- Date helpers ----------
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function daysBetween(a, b) {
    const ms = new Date(b) - new Date(a);
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }
  function addDays(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }
  function isOverdue(dueDate, returnedAt) {
    if (returnedAt) return false;
    return new Date(dueDate).getTime() < Date.now();
  }

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem('idss_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('idss_theme', next);
  }

  // ---------- Text normalization (for fuzzy-ish search & header matching) ----------
  function normalize(str) {
    return (str || '')
      .toString()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .trim();
  }
  function normToken(str) { return normalize(str).replace(/[^\w]/g, ''); }

  /* ============================================================
     Generic tabular PDF import (shared by all three bulk-import
     features: library items, students, staff).
     Requires pdfjsLib to be loaded on the page (pdf.js from CDN) and its
     GlobalWorkerOptions.workerSrc set \u2014 pages that use this call
     ensurePdfWorker() first.

     Strategy: pdf.js gives every text run its own x/y position (no line
     or column grouping). We group runs into lines by y, then find the
     header row by matching each run's text against the same alias lists
     already used for the .xlsx import of that data \u2014 whichever row has
     the most alias matches wins. That row's x positions become column
     boundaries; every row below is split into columns by nearest x, so
     it works for any table layout without hardcoding one document's
     format. This is inherently less reliable than .xlsx (no cell
     structure to read, just visual position), so callers must still run
     it through the same validate/dedupe/preview pipeline as any other
     import source \u2014 never trust it blindly.
     ============================================================ */
  function ensurePdfWorker() {
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
  }

  async function pdfExtractPositionedLines(file) {
    ensurePdfWorker();
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const byY = new Map();
      content.items.forEach(item => {
        if (!item.str || !item.str.trim()) return;
        const y = Math.round(item.transform[5]);
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ str: item.str.trim(), x: item.transform[4] });
      });
      const pageLines = Array.from(byY.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.x - b.x));
      lines = lines.concat(pageLines);
    }
    return lines; // array of lines, each an array of {str, x} left-to-right
  }

  // aliasMap: { fieldName: ['alias one', 'alias two', ...] }
  // Returns array of row objects keyed by fieldName, plus _rowRef for messages.
  async function parsePdfTable(file, aliasMap) {
    const lines = await pdfExtractPositionedLines(file);
    const fieldFor = (tok) => {
      for (const [field, aliases] of Object.entries(aliasMap)) {
        if (aliases.some(a => normToken(a) === tok)) return field;
      }
      return null;
    };

    let headerLineIdx = -1, headerCols = null;
    lines.forEach((line, i) => {
      if (headerLineIdx !== -1) return;
      const matches = [];
      line.forEach(item => {
        const field = fieldFor(normToken(item.str));
        if (field && !matches.some(m => m.field === field)) matches.push({ field, x: item.x });
      });
      if (matches.length >= 2) { headerLineIdx = i; headerCols = matches.sort((a, b) => a.x - b.x); }
    });
    if (headerLineIdx === -1) return [];

    const rows = [];
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const rowObj = {};
      let any = false;
      lines[i].forEach(item => {
        // the item belongs to the last header column whose x it's at or past
        let best = headerCols[0];
        for (const col of headerCols) { if (item.x + 8 >= col.x) best = col; else break; }
        rowObj[best.field] = ((rowObj[best.field] || '') + ' ' + item.str).trim();
        any = true;
      });
      if (any) { rowObj._rowRef = `PDF red ${i - headerLineIdx}`; rows.push(rowObj); }
    }
    return rows;
  }

  return {
    apiList, apiListAll, apiGet, apiCreate, apiUpdate, apiDelete,
    uid, getAuthClient, initAuthSession, getSession, getAccessToken, clearSession, requireSession, hasRole,
    toast, showLoading, hideLoading, logAudit,
    fmtDate, fmtDateTime, daysBetween, addDays, isOverdue,
    initTheme, toggleTheme, normalize, normToken,
    ensurePdfWorker, parsePdfTable
  };
})();
