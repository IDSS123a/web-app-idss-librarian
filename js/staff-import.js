/* ============================================================
   IDSS Librarian — Staff (nastavnici/bibliotekari) bulk import
   Pipeline: parse (.xlsx or .pdf) -> dedupe by name -> preview
             (Novo/Vec postoji/Greska) -> explicit confirm (UVEZI)
             -> upsert -> result summary. Same shape as the students
             and library-item importers, for a consistent workflow.

   Duplicate rule: staff have no natural unique code (unlike a student's
   sifra or a book's ISBN), so the match key is normalized full name.
   A match is never silently merged — it's shown as "Vec postoji" with
   the existing account's current role, and confirming updates that
   account (email/role/active) instead of creating a second one.
   ============================================================ */

const STAFF_HEADER_ALIASES = {
  full_name: ['full_name', 'ime i prezime', 'ime', 'naziv', 'name'],
  email: ['email', 'e-mail', 'e mail'],
  role: ['role', 'uloga'],
  active: ['active', 'aktivan'],
  subject: ['subject', 'predmet', 'predmeti'],
  grade: ['grade', 'razred', 'razredi']
};
const STAFF_ROLE_MAP = {
  administrator: 'admin', admin: 'admin', bibliotekar: 'librarian', librarian: 'librarian',
  pregled: 'viewer', viewer: 'viewer', nastavnik: 'teacher', teacher: 'teacher', profesor: 'teacher'
};

let STAFF_IMPORT_STATE = { rows: [] };

function openStaffImportModal() {
  if (!guardRole('admin')) return;
  STAFF_IMPORT_STATE = { rows: [] };
  document.getElementById('staff-import-file-input').value = '';
  document.getElementById('staff-import-upload-error').classList.add('hidden');
  showStaffImportStep('upload');
  document.getElementById('staff-import-modal').classList.remove('hidden');
}
function closeStaffImportModal() {
  document.getElementById('staff-import-modal').classList.add('hidden');
  loadStaffAdmin();
}
function backToStaffImportUpload() { showStaffImportStep('upload'); }
function showStaffImportStep(step) {
  ['upload', 'processing', 'preview', 'result'].forEach(s => document.getElementById(`staff-import-step-${s}`).classList.toggle('hidden', s !== step));
}
function showStaffImportError(msg) {
  const box = document.getElementById('staff-import-upload-error');
  box.textContent = msg;
  box.classList.remove('hidden');
}

function downloadStaffImportTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['full_name', 'email', 'role', 'active', 'subject', 'grade'],
    ['Amina Hodzic', 'amina.hodzic@idss.local', 'librarian', 'true', '', ''],
    ['Emir Kovac', 'emir.kovac@idss.local', 'teacher', 'true', 'Matematika', '6']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Osoblje');
  XLSX.writeFile(wb, 'IDSS_Uvoz_Osoblja_Predlozak.xlsx');
}

async function processStaffImportFile() {
  const fileInput = document.getElementById('staff-import-file-input');
  const errBox = document.getElementById('staff-import-upload-error');
  errBox.classList.add('hidden');
  const file = fileInput.files[0];
  if (!file) { showStaffImportError('Molimo izaberite .xlsx ili .pdf fajl.'); return; }
  const name = file.name.toLowerCase();

  showStaffImportStep('processing');
  try {
    let rawRows;
    if (name.endsWith('.xlsx')) {
      rawRows = await parseStaffXlsx(file);
    } else if (name.endsWith('.pdf')) {
      rawRows = await parseStaffPdf(file);
    } else {
      showStaffImportStep('upload');
      showStaffImportError('Podrzani formati su .xlsx i .pdf.');
      return;
    }
    if (rawRows === null) return; // parser already showed its own error
    if (rawRows.length === 0) { showStaffImportStep('upload'); showStaffImportError('Nije pronadjen nijedan red podataka u fajlu.'); return; }
    buildStaffImportPreview(rawRows);
  } catch (e) {
    console.error(e);
    showStaffImportStep('upload');
    showStaffImportError('Fajl se nije mogao obraditi: ' + (e.message || e));
  }
}

async function parseStaffXlsx(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) return [];

  const headerMap = {};
  Object.keys(rows[0]).forEach(h => {
    const norm = IDSS.normalize(h);
    for (const [field, aliases] of Object.entries(STAFF_HEADER_ALIASES)) {
      if (aliases.some(a => IDSS.normalize(a) === norm)) { headerMap[h] = field; break; }
    }
  });
  if (!Object.values(headerMap).includes('full_name')) {
    showStaffImportStep('upload');
    showStaffImportError('Fajl ne sadrzi kolonu za ime i prezime (full_name / ime i prezime).');
    return null;
  }

  return rows.map((r, idx) => {
    const obj = { _rowRef: `red ${idx + 2}` };
    Object.entries(headerMap).forEach(([orig, field]) => { obj[field] = (r[orig] ?? '').toString().trim(); });
    return obj;
  }).filter(r => r.full_name);
}

async function parseStaffPdf(file) {
  const rows = await IDSS.parsePdfTable(file, STAFF_HEADER_ALIASES);
  if (rows.length === 0) {
    showStaffImportStep('upload');
    showStaffImportError('Nije prepoznata tabela sa kolonom imena u PDF-u. PDF uvoz zahtijeva jasnu tabelu sa zaglavljem — provjerite fajl ili koristite .xlsx.');
    return null;
  }
  return rows.filter(r => (r.full_name || '').trim());
}

function buildStaffImportPreview(rawRows) {
  const existingByName = new Map(ALL_STAFF.map(s => [IDSS.normalize(s.full_name), s]));

  const preview = rawRows.map(r => {
    const fullName = (r.full_name || '').trim();
    const errors = [];
    if (!fullName) errors.push('Nedostaje ime i prezime');

    const roleRaw = IDSS.normalize(r.role || '');
    const role = STAFF_ROLE_MAP[roleRaw] || (roleRaw ? '' : 'librarian');
    if (r.role && !role) errors.push(`Nepoznata uloga: "${r.role}" (dozvoljeno: admin/librarian/viewer)`);

    const activeVal = (r.active || '').toString().trim().toLowerCase();
    const active = activeVal === '' ? true : ['true', '1', 'da', 'yes'].includes(activeVal);

    let status = 'new', existing = null;
    if (errors.length > 0) {
      status = 'error';
    } else if (existingByName.has(IDSS.normalize(fullName))) {
      status = 'exists';
      existing = existingByName.get(IDSS.normalize(fullName));
    }

    return {
      full_name: fullName, email: (r.email || '').trim(), role: role || 'librarian', active,
      subject: (r.subject || '').trim(), grade: (r.grade || '').trim(),
      status, errors, existingId: existing ? existing.id : null, existingRole: existing ? existing.role : ''
    };
  });

  STAFF_IMPORT_STATE.rows = preview;
  renderStaffImportPreview();
  showStaffImportStep('preview');
}

function renderStaffImportPreview() {
  const rows = STAFF_IMPORT_STATE.rows;
  const newCount = rows.filter(r => r.status === 'new').length;
  const existsCount = rows.filter(r => r.status === 'exists').length;
  const errorCount = rows.filter(r => r.status === 'error').length;
  document.getElementById('staff-import-preview-summary').textContent =
    `${newCount} novih naloga, ${existsCount} vec postoji (bice azurirano), ${errorCount} sa greskom.`;

  const roleLabel = { admin: 'Administrator', librarian: 'Bibliotekar', viewer: 'Pregled', teacher: 'Nastavnik' };
  document.getElementById('staff-import-preview-tbody').innerHTML = rows.map(r => {
    const badge = r.status === 'new' ? '<span class="badge badge-available">Novo</span>' :
      r.status === 'exists' ? '<span class="badge badge-borrowed">Vec postoji</span>' :
      '<span class="badge badge-overdue">Greska</span>';
    const details = r.status === 'exists' ? `Postojeca uloga: ${roleLabel[r.existingRole] || r.existingRole}` : r.errors.join('; ') || '—';
    const psg = [r.subject, r.grade].filter(Boolean).join(' / ') || '—';
    return `<tr>
      <td>${badge}</td><td>${escH(r.full_name)}</td><td>${escH(r.email || '—')}</td>
      <td>${roleLabel[r.role] || r.role}</td><td>${escH(psg)}</td><td class="text-sm text-muted">${details}</td>
    </tr>`;
  }).join('');
}

async function confirmStaffImport() {
  const rows = STAFF_IMPORT_STATE.rows.filter(r => r.status !== 'error');
  const errorRows = STAFF_IMPORT_STATE.rows.filter(r => r.status === 'error');
  if (rows.length === 0) { IDSS.toast('Nema naloga za uvoz (svi zahtijevaju rucnu provjeru).', 'error'); return; }

  document.getElementById('staff-import-confirm-btn').disabled = true;
  IDSS.showLoading('Uvozim osoblje...');
  let newCount = 0, updatedCount = 0;
  try {
    for (const r of rows) {
      if (r.status === 'new') {
        const created = await IDSS.apiCreate('staff', { id: IDSS.uid('staff-'), full_name: r.full_name, email: r.email, role: r.role, active: r.active, subject: r.subject, grade: r.grade });
        ALL_STAFF.push(created);
        await IDSS.logAudit('staff_created', 'staff', created.id, { full_name: r.full_name, source: 'bulk_import' });
        newCount++;
      } else {
        const updated = await IDSS.apiUpdate('staff', r.existingId, { email: r.email, role: r.role, active: r.active, subject: r.subject, grade: r.grade });
        const idx = ALL_STAFF.findIndex(s => s.id === r.existingId);
        if (idx >= 0) ALL_STAFF[idx] = updated;
        await IDSS.logAudit('staff_updated', 'staff', r.existingId, { full_name: r.full_name, source: 'bulk_import' });
        updatedCount++;
      }
    }
    await IDSS.logAudit('staff_bulk_imported', 'staff', '', { new_count: newCount, updated_count: updatedCount, error_count: errorRows.length });

    document.getElementById('staff-import-result-text').textContent =
      `${newCount} novih naloga, ${updatedCount} azurirano.` + (errorRows.length > 0 ? ` ${errorRows.length} redova preskoceno (greska).` : '');
    showStaffImportStep('result');
    renderStaffListAdmin();
    IDSS.toast('Osoblje uspjesno uvezeno.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri uvozu. Neki nalozi mozda nisu sacuvani.', 'error');
  } finally {
    document.getElementById('staff-import-confirm-btn').disabled = false;
    IDSS.hideLoading();
  }
}

function escH(s) { return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
