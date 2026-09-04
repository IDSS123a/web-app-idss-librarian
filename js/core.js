/* ============================================================
   IDSS Librarian — Core utilities
   Table API wrapper, session/attribution, toast, loading, audit log
   ============================================================ */

const IDSS = (() => {

  // ---------- Generic Table API wrapper ----------
  async function apiList(table, { page = 1, limit = 100, search = '', sort = '' } = {}) {
    const params = new URLSearchParams({ page, limit });
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    const res = await fetch(`tables/${table}?${params.toString()}`);
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
    const res = await fetch(`tables/${table}/${id}`);
    if (!res.ok) throw new Error('Zapis nije pronadjen');
    return res.json();
  }

  async function apiCreate(table, data) {
    const res = await fetch(`tables/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Neuspjelo cuvanje podataka');
    return res.json();
  }

  async function apiUpdate(table, id, data) {
    const res = await fetch(`tables/${table}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Neuspjelo azuriranje podataka');
    return res.json();
  }

  async function apiDelete(table, id) {
    const res = await fetch(`tables/${table}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Neuspjelo brisanje');
    return true;
  }

  // ---------- IDs ----------
  function uid(prefix = '') {
    const rnd = Math.random().toString(36).slice(2, 10);
    const t = Date.now().toString(36);
    return `${prefix}${t}${rnd}`;
  }

  // ---------- Session / attribution (NOT a security boundary — see README) ----------
  const SESSION_KEY = 'idss_librarian_session';

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setSession(staff) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(staff));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function requireSession() {
    const s = getSession();
    if (!s) {
      window.location.href = 'login.html';
      return null;
    }
    return s;
  }

  function hasRole(...roles) {
    const s = getSession();
    return !!s && roles.includes(s.role);
  }

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

  return {
    apiList, apiListAll, apiGet, apiCreate, apiUpdate, apiDelete,
    uid, getSession, setSession, clearSession, requireSession, hasRole,
    toast, showLoading, hideLoading, logAudit,
    fmtDate, fmtDateTime, daysBetween, addDays, isOverdue,
    initTheme, toggleTheme, normalize
  };
})();
