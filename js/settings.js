/* ============================================================
   IDSS Librarian — Settings (admin-only)
   ============================================================ */

let CURRENT_SETTINGS = null;
let CURRENT_CATEGORIES = [];

(async function init() {
  await renderShell('settings');
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

let ALL_STAFF = [];
let ALL_TEACHER_ASSIGNMENTS = [];
async function loadStaffAdmin() {
  ALL_STAFF = await IDSS.apiListAll('staff');
  ALL_TEACHER_ASSIGNMENTS = await IDSS.apiListAll('teacher_assignments');
  renderStaffListAdmin();
}
const STAFF_ROLE_LABELS = { admin: 'Administrator', librarian: 'Bibliotekar', viewer: 'Pregled', teacher: 'Nastavnik' };
function staffAssignmentsText(staffId) {
  const rows = ALL_TEACHER_ASSIGNMENTS.filter(a => a.teacher_id === staffId);
  if (!rows.length) return '';
  const bySubj = {};
  rows.forEach(a => { (bySubj[a.subject] = bySubj[a.subject] || []).push(a.grade); });
  return Object.entries(bySubj).map(([s, grades]) => `${s} (${grades.join(', ')})`).join('; ');
}
function renderStaffListAdmin() {
  document.getElementById('staff-list-admin').innerHTML = ALL_STAFF.map(s => {
    const teacherInfo = s.role === 'teacher' ? staffAssignmentsText(s.id) : '';
    return `
    <div class="flex items-center justify-between" style="padding:8px 0; border-bottom:1px solid var(--border-soft);">
      <div><strong>${escSA(s.full_name)}</strong> <span class="text-muted text-sm">(${STAFF_ROLE_LABELS[s.role] || s.role})</span>
        <div class="text-muted text-sm">${escSA(s.email || '(nema emaila — ne moze se prijaviti)')}</div>
        ${teacherInfo ? `<div class="text-muted text-sm">${escSA(teacherInfo)}</div>` : ''}
      </div>
      <div class="flex items-center gap-8">
        <span class="badge ${s.auth_user_id ? 'badge-available' : 'badge-borrowed'}">${s.auth_user_id ? 'Nalog aktiviran' : 'Ceka prvu prijavu'}</span>
        <span class="badge ${s.active === false ? 'badge-lost' : 'badge-available'}">${s.active === false ? 'Neaktivan' : 'Aktivan'}</span>
        <button class="btn btn-sm btn-neutral" onclick="openEditStaffAdminModal('${s.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-neutral" onclick="deleteStaffAdmin('${s.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}
function escSA(s) { return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* ================= ADD / EDIT / DELETE STAFF (manual) ================= */

function toggleSaTeacherFields() {
  const isTeacher = document.getElementById('sa-role').value === 'teacher';
  document.getElementById('sa-teacher-fields-wrap').classList.toggle('hidden', !isTeacher);
}
function addSaAssignmentRow(subject, grade) {
  const wrap = document.getElementById('sa-assignment-rows');
  const row = document.createElement('div');
  row.className = 'flex gap-8 mb-8 sa-assignment-row';
  row.innerHTML = `
    <input class="input sa-a-subject" placeholder="Predmet (npr. Mathematik)" value="${escSA(subject || '')}">
    <input class="input sa-a-grade" placeholder="Razred (npr. 6)" style="max-width:120px;" value="${escSA(grade || '')}">
    <button class="btn btn-sm btn-neutral" onclick="this.closest('.sa-assignment-row').remove()"><i class="fa-solid fa-xmark"></i></button>`;
  wrap.appendChild(row);
}

function openAddStaffAdminModal() {
  document.getElementById('staff-admin-modal-title').textContent = 'Novi nalog';
  document.getElementById('sa-edit-id').value = '';
  document.getElementById('sa-full-name').value = '';
  document.getElementById('sa-email').value = '';
  document.getElementById('sa-role').value = 'librarian';
  document.getElementById('sa-active').value = 'true';
  document.getElementById('sa-assignment-rows').innerHTML = '';
  toggleSaTeacherFields();
  document.getElementById('staff-admin-modal').classList.remove('hidden');
}
function openEditStaffAdminModal(id) {
  const s = ALL_STAFF.find(x => x.id === id);
  if (!s) return;
  document.getElementById('staff-admin-modal-title').textContent = 'Uredi nalog';
  document.getElementById('sa-edit-id').value = s.id;
  document.getElementById('sa-full-name').value = s.full_name || '';
  document.getElementById('sa-email').value = s.email || '';
  document.getElementById('sa-role').value = s.role || 'librarian';
  document.getElementById('sa-active').value = s.active === false ? 'false' : 'true';
  document.getElementById('sa-assignment-rows').innerHTML = '';
  const rows = ALL_TEACHER_ASSIGNMENTS.filter(a => a.teacher_id === id);
  if (rows.length) rows.forEach(a => addSaAssignmentRow(a.subject, a.grade));
  else if (s.role === 'teacher' && (s.subject || s.grade)) addSaAssignmentRow(s.subject, s.grade); // legacy single-value fallback
  toggleSaTeacherFields();
  document.getElementById('staff-admin-modal').classList.remove('hidden');
}
function closeStaffAdminModal() { document.getElementById('staff-admin-modal').classList.add('hidden'); }

async function saveStaffAdmin() {
  const id = document.getElementById('sa-edit-id').value;
  const full_name = document.getElementById('sa-full-name').value.trim();
  const email = document.getElementById('sa-email').value.trim();
  const role = document.getElementById('sa-role').value;
  const active = document.getElementById('sa-active').value === 'true';
  if (!full_name) { IDSS.toast('Unesite ime i prezime.', 'error'); return; }
  if (!email) { IDSS.toast('Email je obavezan — koristi se za prijavu.', 'error'); return; }

  const dupName = ALL_STAFF.find(s => IDSS.normalize(s.full_name) === IDSS.normalize(full_name) && s.id !== id);
  if (dupName) { IDSS.toast('Nalog sa ovim imenom i prezimenom vec postoji.', 'error'); return; }
  const dupEmail = ALL_STAFF.find(s => IDSS.normalize(s.email) === IDSS.normalize(email) && s.id !== id);
  if (dupEmail) { IDSS.toast('Nalog sa ovim emailom vec postoji.', 'error'); return; }

  const assignments = [];
  if (role === 'teacher') {
    document.querySelectorAll('#sa-assignment-rows .sa-assignment-row').forEach(row => {
      const subject = row.querySelector('.sa-a-subject').value.trim();
      const grade = row.querySelector('.sa-a-grade').value.trim();
      if (subject && grade) assignments.push({ subject, grade });
    });
  }

  IDSS.showLoading('Cuvanje naloga...');
  try {
    let staffId = id;
    // subject/grade legacy columns kept in sync with the first assignment, for
    // any older screen that still reads them directly.
    const legacySubject = assignments.length ? assignments[0].subject : '';
    const legacyGrade = assignments.length ? assignments[0].grade : '';
    if (id) {
      const updated = await IDSS.apiUpdate('staff', id, { full_name, email, role, active, subject: legacySubject, grade: legacyGrade });
      const idx = ALL_STAFF.findIndex(s => s.id === id);
      if (idx >= 0) ALL_STAFF[idx] = updated;
      await IDSS.logAudit('staff_updated', 'staff', id, { full_name, source: 'manual' });
    } else {
      staffId = IDSS.uid('staff-');
      const created = await IDSS.apiCreate('staff', { id: staffId, full_name, email, role, active, subject: legacySubject, grade: legacyGrade });
      ALL_STAFF.push(created);
      await IDSS.logAudit('staff_created', 'staff', staffId, { full_name, source: 'manual' });
    }

    // Reconcile teacher_assignments: delete this teacher's existing rows, insert the current form state.
    const existingRows = ALL_TEACHER_ASSIGNMENTS.filter(a => a.teacher_id === staffId);
    for (const row of existingRows) await IDSS.apiDelete('teacher_assignments', row.id);
    const newRows = [];
    for (const a of assignments) {
      const created = await IDSS.apiCreate('teacher_assignments', { id: IDSS.uid('ta-'), teacher_id: staffId, subject: a.subject, grade: a.grade });
      newRows.push(created);
    }
    ALL_TEACHER_ASSIGNMENTS = ALL_TEACHER_ASSIGNMENTS.filter(a => a.teacher_id !== staffId).concat(newRows);

    closeStaffAdminModal();
    renderStaffListAdmin();
    IDSS.toast('Nalog sacuvan.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri cuvanju naloga.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

async function deleteStaffAdmin(id) {
  const s = ALL_STAFF.find(x => x.id === id);
  if (!s) return;
  if (id === 'staff-admin') { IDSS.toast('Osnovni administratorski nalog se ne moze obrisati.', 'error'); return; }
  if (!confirm(`Da li ste sigurni da zelite obrisati nalog "${s.full_name}"? Ova radnja se ne moze ponistiti.`)) return;

  IDSS.showLoading('Brisanje...');
  try {
    const activeLoans = (await IDSS.apiListAll('borrowings')).filter(b => b.teacher_id === id && b.status === 'borrowed');
    if (activeLoans.length > 0) {
      IDSS.toast(`Ne moze se obrisati: ${activeLoans.length} aktivno zaduzenje preko ovog nastavnika. Prvo razdužite ili deaktivirajte nalog.`, 'error');
      return;
    }
    for (const row of ALL_TEACHER_ASSIGNMENTS.filter(a => a.teacher_id === id)) await IDSS.apiDelete('teacher_assignments', row.id);
    await IDSS.apiDelete('staff', id);
    ALL_STAFF = ALL_STAFF.filter(x => x.id !== id);
    ALL_TEACHER_ASSIGNMENTS = ALL_TEACHER_ASSIGNMENTS.filter(a => a.teacher_id !== id);
    await IDSS.logAudit('staff_deleted', 'staff', id, { full_name: s.full_name });
    renderStaffListAdmin();
    IDSS.toast('Nalog obrisan.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri brisanju.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}
