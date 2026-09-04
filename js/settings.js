/* ============================================================
   IDSS Librarian — Settings (admin-only)
   ============================================================ */

let CURRENT_SETTINGS = null;
let CURRENT_CATEGORIES = [];

(async function init() {
  renderShell('settings');
  if (!guardRole('admin')) return;
  await loadSettings();
  await loadCategoriesAdmin();
  await loadStaffAdmin();
  await loadAuditLog();
})();

async function loadAuditLog() {
  try {
    const res = await IDSS.apiList('audit_log', { limit: 50, sort: '-occurred_at' });
    let rows = res.data || [];
    rows = rows.slice().sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    document.getElementById('audit-log-tbody').innerHTML = rows.map(r => {
      let meta = '';
      try { const m = JSON.parse(r.metadata || '{}'); meta = Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', '); } catch (e) {}
      return `<tr><td>${IDSS.fmtDateTime(r.occurred_at)}</td><td>${r.actor}</td><td>${r.action}</td><td>${r.entity}</td><td class="text-sm text-muted">${meta}</td></tr>`;
    }).join('') || `<tr><td colspan="5" class="text-muted">Nema zabiljezenih akcija.</td></tr>`;
  } catch (e) {
    console.warn('Audit log load failed', e);
  }
}

async function loadSettings() {
  IDSS.showLoading('Ucitavanje podesavanja...');
  try {
    const res = await IDSS.apiList('settings', { limit: 1 });
    CURRENT_SETTINGS = (res.data && res.data[0]) || null;
    if (!CURRENT_SETTINGS) {
      CURRENT_SETTINGS = await IDSS.apiCreate('settings', { id: 'default', school_name: '', library_name: '', default_loan_period_days: 14, inventory_prefix: 'IDSS-LIB-', next_inventory_seq: 1 });
    }
    document.getElementById('set-school-name').value = CURRENT_SETTINGS.school_name || '';
    document.getElementById('set-library-name').value = CURRENT_SETTINGS.library_name || '';
    document.getElementById('set-loan-period').value = CURRENT_SETTINGS.default_loan_period_days || 14;
    document.getElementById('set-inv-prefix').value = CURRENT_SETTINGS.inventory_prefix || 'IDSS-LIB-';
    document.getElementById('set-next-seq').value = CURRENT_SETTINGS.next_inventory_seq || 1;
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri ucitavanju podesavanja.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

async function saveSettings() {
  IDSS.showLoading('Cuvanje...');
  try {
    const data = {
      school_name: document.getElementById('set-school-name').value.trim(),
      library_name: document.getElementById('set-library-name').value.trim(),
      default_loan_period_days: parseInt(document.getElementById('set-loan-period').value) || 14,
      inventory_prefix: document.getElementById('set-inv-prefix').value.trim() || 'IDSS-LIB-',
      next_inventory_seq: parseInt(document.getElementById('set-next-seq').value) || 1
    };
    await IDSS.apiUpdate('settings', CURRENT_SETTINGS.id, data);
    await IDSS.logAudit('settings_updated', 'settings', CURRENT_SETTINGS.id, data);
    IDSS.toast('Podesavanja sacuvana.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri cuvanju podesavanja.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

async function loadCategoriesAdmin() {
  CURRENT_CATEGORIES = await IDSS.apiListAll('categories');
  renderCategoriesList();
}
function renderCategoriesList() {
  const el = document.getElementById('categories-list');
  el.innerHTML = CURRENT_CATEGORIES.map(c => `
    <div class="flex items-center justify-between" style="padding:8px 0; border-bottom:1px solid var(--border-soft);">
      <span class="${c.active === false ? 'text-muted' : ''}">${c.name}</span>
      <div class="flex gap-8">
        <button class="btn btn-sm btn-neutral" onclick="toggleCategory('${c.id}')">${c.active === false ? 'Aktiviraj' : 'Deaktiviraj'}</button>
      </div>
    </div>`).join('');
}
async function toggleCategory(id) {
  const c = CURRENT_CATEGORIES.find(x => x.id === id);
  const updated = await IDSS.apiUpdate('categories', id, { active: !(c.active !== false) });
  Object.assign(c, updated);
  renderCategoriesList();
}
async function addCategoryPrompt() {
  const name = prompt('Naziv nove kategorije:');
  if (!name || !name.trim()) return;
  const created = await IDSS.apiCreate('categories', { id: IDSS.uid('cat-'), name: name.trim(), active: true });
  CURRENT_CATEGORIES.push(created);
  renderCategoriesList();
  IDSS.toast('Kategorija dodana.', 'success');
}

async function loadStaffAdmin() {
  const staff = await IDSS.apiListAll('staff');
  document.getElementById('staff-list-admin').innerHTML = staff.map(s => `
    <div class="flex items-center justify-between" style="padding:8px 0; border-bottom:1px solid var(--border-soft);">
      <div><strong>${s.full_name}</strong> <span class="text-muted text-sm">(${({admin:'Administrator',librarian:'Bibliotekar',viewer:'Pregled'})[s.role] || s.role})</span></div>
      <span class="badge ${s.active === false ? 'badge-lost' : 'badge-available'}">${s.active === false ? 'Neaktivan' : 'Aktivan'}</span>
    </div>`).join('');
}
