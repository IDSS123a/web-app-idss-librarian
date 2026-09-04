/* ============================================================
   IDSS Librarian — Students page + Bulk XLSX import (spec 19a)
   ============================================================ */

let ALL_STUDENTS = [];
let ALL_BORROWINGS_S = [];

(async function init() {
  renderShell('students');
  // Import is admin-only by default per spec 19a
  if (!IDSS.hasRole('admin')) {
    document.getElementById('import-btn').style.display = 'none';
  }
  await loadStudents();
  document.getElementById('s-search').addEventListener('input', debounceS(renderStudentsTable, 250));
  document.getElementById('s-filter-active').addEventListener('change', renderStudentsTable);
})();

function debounceS(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadStudents() {
  IDSS.showLoading('Ucitavanje ucenika...');
  try {
    ALL_STUDENTS = await IDSS.apiListAll('library_users');
    ALL_BORROWINGS_S = await IDSS.apiListAll('borrowings');
    renderStudentsTable();
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri ucitavanju ucenika.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

function renderStudentsTable() {
  const q = IDSS.normalize(document.getElementById('s-search').value);
  const activeFilter = document.getElementById('s-filter-active').value;
  let rows = ALL_STUDENTS.slice();
  if (activeFilter === 'true') rows = rows.filter(s => s.active !== false);
  else if (activeFilter === 'false') rows = rows.filter(s => s.active === false);
  if (q) rows = rows.filter(s => IDSS.normalize(`${s.first_name} ${s.last_name} ${s.student_id} ${s.class_name}`).includes(q));

  const tbody = document.getElementById('students-tbody');
  const emptyEl = document.getElementById('students-empty');
  document.getElementById('students-count-sub').textContent = `${ALL_STUDENTS.length} ucenika ukupno`;

  if (rows.length === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = `<div class="empty-state"><div class="ei"><i class="fa-solid fa-user-graduate"></i></div><h4>Nema ucenika</h4><p>Dodajte prvog ucenika ili uvezite spisak.</p></div>`;
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = rows.slice(0, 400).map(s => {
    const activeCount = ALL_BORROWINGS_S.filter(t => t.student_record_id === s.id && t.status === 'borrowed').length;
    return `<tr onclick="openStudentDetail('${s.id}')">
      <td class="font-bold">${escH(s.student_id)}</td>
      <td>${escH(s.first_name)} ${escH(s.last_name)}</td>
      <td>${escH(s.class_name || '—')}</td>
      <td>${escH(s.email || '—')}</td>
      <td>${s.active === false ? '<span class="badge badge-lost">Neaktivan</span>' : '<span class="badge badge-available">Aktivan</span>'}</td>
      <td>${activeCount > 0 ? `<span class="badge badge-borrowed">${activeCount}</span>` : '0'}</td>
      <td onclick="event.stopPropagation();">
        <button class="btn btn-sm btn-neutral" onclick="openEditStudentModal('${s.id}')"><i class="fa-solid fa-pen"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function escH(s) { return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* ================= ADD / EDIT STUDENT ================= */

function openAddStudentModal() {
  document.getElementById('student-modal-title').textContent = 'Novi ucenik';
  document.getElementById('student-edit-id').value = '';
  ['s-student-id', 's-class-name', 's-first-name', 's-last-name', 's-email'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('s-active').value = 'true';
  document.getElementById('student-modal').classList.remove('hidden');
}
function openEditStudentModal(id) {
  const s = ALL_STUDENTS.find(x => x.id === id);
  if (!s) return;
  document.getElementById('student-modal-title').textContent = 'Uredi ucenika';
  document.getElementById('student-edit-id').value = s.id;
  document.getElementById('s-student-id').value = s.student_id;
  document.getElementById('s-class-name').value = s.class_name || '';
  document.getElementById('s-first-name').value = s.first_name || '';
  document.getElementById('s-last-name').value = s.last_name || '';
  document.getElementById('s-email').value = s.email || '';
  document.getElementById('s-active').value = s.active === false ? 'false' : 'true';
  document.getElementById('student-modal').classList.remove('hidden');
}
function closeStudentModal() { document.getElementById('student-modal').classList.add('hidden'); }

async function saveStudent() {
  const id = document.getElementById('student-edit-id').value;
  const data = {
    student_id: document.getElementById('s-student-id').value.trim(),
    class_name: document.getElementById('s-class-name').value.trim(),
    first_name: document.getElementById('s-first-name').value.trim(),
    last_name: document.getElementById('s-last-name').value.trim(),
    email: document.getElementById('s-email').value.trim(),
    active: document.getElementById('s-active').value === 'true'
  };
  if (!data.student_id || !data.first_name || !data.last_name || !data.class_name) {
    IDSS.toast('Popunite sva obavezna polja.', 'error'); return;
  }
  // dedup check against other students
  const dup = ALL_STUDENTS.find(s => s.student_id === data.student_id && s.id !== id);
  if (dup) { IDSS.toast('ID ucenika vec postoji.', 'error'); return; }

  IDSS.showLoading('Cuvanje...');
  try {
    if (id) {
      const updated = await IDSS.apiUpdate('library_users', id, data);
      const idx = ALL_STUDENTS.findIndex(s => s.id === id);
      ALL_STUDENTS[idx] = updated;
      await IDSS.logAudit('user_edited', 'library_user', id, { student_id: data.student_id });
    } else {
      const created = await IDSS.apiCreate('library_users', Object.assign({ id: IDSS.uid('stu-') }, data));
      ALL_STUDENTS.push(created);
      await IDSS.logAudit('user_created', 'library_user', created.id, { student_id: data.student_id });
    }
    closeStudentModal();
    renderStudentsTable();
    IDSS.toast('Ucenik sacuvan.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri cuvanju.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

/* ================= STUDENT DETAIL + QR ================= */

async function openStudentDetail(id) {
  const s = ALL_STUDENTS.find(x => x.id === id);
  if (!s) return;
  const history = ALL_BORROWINGS_S.filter(t => t.student_record_id === id).sort((a, b) => new Date(b.borrowed_at) - new Date(a.borrowed_at));
  const activeLoans = history.filter(t => t.status === 'borrowed');
  const overdueLoans = activeLoans.filter(t => IDSS.isOverdue(t.due_date));

  document.getElementById('student-detail-content').innerHTML = `
    <div class="flex items-center gap-16">
      <div id="student-qr-canvas-wrap" style="width:90px;height:90px;background:white;border-radius:10px;box-shadow:var(--shadow-out-sm);display:flex;align-items:center;justify-content:center;"></div>
      <div>
        <h3 style="margin:0;">${escH(s.first_name)} ${escH(s.last_name)}</h3>
        <p class="text-secondary" style="margin:2px 0 0;">${escH(s.class_name || '')} · ID: ${escH(s.student_id)}</p>
      </div>
    </div>
    <div class="flex gap-16 mt-16">
      <div><div class="stat-value" style="font-size:20px;">${history.length}</div><div class="stat-label">Ukupno zaduzenja</div></div>
      <div><div class="stat-value" style="font-size:20px;color:#92600a;">${activeLoans.length}</div><div class="stat-label">Trenutno zaduzeno</div></div>
      <div><div class="stat-value" style="font-size:20px;color:#E8262C;">${overdueLoans.length}</div><div class="stat-label">U kasnjenju</div></div>
    </div>
    <h4 class="mt-16">Istorija zaduzenja</h4>
    <div style="max-height:220px; overflow-y:auto;">
      ${history.length === 0 ? '<p class="text-muted text-sm">Nema zaduzenja.</p>' : history.map(t => `
        <div class="flex justify-between" style="padding:8px 0; border-bottom:1px solid var(--border-soft);">
          <span class="text-sm">${escH(t.book_title)}</span>
          <span class="text-sm text-muted">${t.returned_at ? 'Vraceno ' + IDSS.fmtDate(t.returned_at) : 'Zaduzeno do ' + IDSS.fmtDate(t.due_date)}</span>
        </div>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-neutral" onclick="printStudentCard('${s.id}')"><i class="fa-solid fa-print"></i> Stampaj karticu</button>
      <button class="btn btn-neutral" onclick="closeStudentDetailModal()">Zatvori</button>
    </div>
  `;
  document.getElementById('student-detail-modal').classList.remove('hidden');
  try {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, s.student_id, { width: 90, margin: 1 });
    document.getElementById('student-qr-canvas-wrap').innerHTML = '';
    document.getElementById('student-qr-canvas-wrap').appendChild(canvas);
  } catch (e) { console.warn('QR generation failed', e); }
}
function closeStudentDetailModal() { document.getElementById('student-detail-modal').classList.add('hidden'); }

async function printStudentCard(id) {
  const s = ALL_STUDENTS.find(x => x.id === id);
  if (!s) return;
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, s.student_id, { width: 200, margin: 1 });
  const dataUrl = canvas.toDataURL();
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Kartica - ${escH(s.first_name)} ${escH(s.last_name)}</title>
    <style>body{font-family:sans-serif;text-align:center;padding:40px;} .card{display:inline-block;border:2px solid #035EA1;border-radius:16px;padding:24px 40px;}</style>
    </head><body>
    <div class="card">
      <h2>${escH(s.first_name)} ${escH(s.last_name)}</h2>
      <p>${escH(s.class_name || '')} · ID: ${escH(s.student_id)}</p>
      <img src="${dataUrl}">
      <p style="font-size:12px;color:#888;">IDSS Library Card</p>
    </div>
    <script>window.onload = () => window.print();<\/script>
    </body></html>`);
  w.document.close();
}

/* =====================================================================
   BULK IMPORT (spec 19a)
   Pipeline: parse -> structural validate -> preview (New/Update/Error)
             -> explicit confirm -> upsert by student_id -> result summary
   Never write from file directly; duplicate student_id within file = error
   Absent students never deactivated.
   ===================================================================== */

const REQUIRED_COLS = ['student_id', 'first_name', 'last_name', 'class_name'];
const HEADER_ALIASES = {
  student_id: ['student_id', 'sifra ucenika', 'sifra_ucenika', 'id ucenika', 'sifra', 'id'],
  first_name: ['first_name', 'ime'],
  last_name: ['last_name', 'prezime'],
  class_name: ['class_name', 'razred'],
  email: ['email', 'e-mail', 'e mail'],
  active: ['active', 'aktivan']
};

let IMPORT_STATE = { previewRows: [] };

function openImportModal() {
  if (!guardRole('admin')) return;
  IMPORT_STATE = { previewRows: [] };
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-upload-error').classList.add('hidden');
  showImportStep('upload');
  document.getElementById('import-modal').classList.remove('hidden');
}
function closeImportModal() { document.getElementById('import-modal').classList.add('hidden'); loadStudents(); }
function backToImportUpload() { showImportStep('upload'); }
function showImportStep(step) {
  ['upload', 'processing', 'preview', 'result'].forEach(s => document.getElementById(`import-step-${s}`).classList.toggle('hidden', s !== step));
}

function downloadImportTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['student_id', 'first_name', 'last_name', 'class_name', 'email', 'active'],
    ['S12345', 'Amina', 'Hodzic', '7B', 'amina.hodzic@example.com', 'true']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ucenici');
  XLSX.writeFile(wb, 'IDSS_Uvoz_Ucenika_Predlozak.xlsx');
}

function normalizeHeader(h) { return IDSS.normalize(h); }

function matchHeaderToField(header) {
  const norm = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some(a => IDSS.normalize(a) === norm)) return field;
  }
  return null;
}

async function processImportFile() {
  const fileInput = document.getElementById('import-file-input');
  const errBox = document.getElementById('import-upload-error');
  errBox.classList.add('hidden');
  const file = fileInput.files[0];
  if (!file) { showImportError('Molimo izaberite .xlsx fajl.'); return; }
  if (!file.name.toLowerCase().endsWith('.xlsx')) { showImportError('Molimo uploadujte .xlsx fajl.'); return; }

  showImportStep('processing');
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) { showImportStep('upload'); showImportError('Fajl ne sadrzi nijedan red podataka.'); return; }

    // Map headers -> canonical fields
    const sampleRow = rows[0];
    const headerMap = {}; // originalHeader -> field
    Object.keys(sampleRow).forEach(h => {
      const field = matchHeaderToField(h);
      if (field) headerMap[h] = field;
    });
    const mappedFields = new Set(Object.values(headerMap));
    const missing = REQUIRED_COLS.filter(f => !mappedFields.has(f));
    if (missing.length > 0) {
      const bsNames = { student_id: 'Sifra ucenika', first_name: 'Ime', last_name: 'Prezime', class_name: 'Razred' };
      showImportStep('upload');
      showImportError(`Fajl ne sadrzi obavezne kolone: ${missing.map(m => bsNames[m]).join(', ')}.`);
      return;
    }

    // Build normalized row objects
    const normRows = rows.map((r, idx) => {
      const obj = { _rowNum: idx + 2 }; // +2: header is row1, data starts row2
      Object.entries(headerMap).forEach(([origHeader, field]) => { obj[field] = (r[origHeader] ?? '').toString().trim(); });
      return obj;
    }).filter(r => {
      // exclude completely empty rows
      return REQUIRED_COLS.some(f => (r[f] || '').toString().trim() !== '') || (r.email || '').trim() !== '';
    });

    if (normRows.length === 0) { showImportStep('upload'); showImportError('Fajl ne sadrzi nijedan red podataka.'); return; }

    buildImportPreview(normRows);
  } catch (e) {
    console.error(e);
    showImportStep('upload');
    showImportError('Fajl se nije mogao obraditi. Provjerite da je u ispravnom .xlsx formatu.');
  }
}

function showImportError(msg) {
  const box = document.getElementById('import-upload-error');
  box.textContent = msg;
  box.classList.remove('hidden');
}

function buildImportPreview(normRows) {
  const existingByStudentId = new Map(ALL_STUDENTS.map(s => [s.student_id, s]));
  const seenInFile = new Map(); // student_id -> [rowNum,...]
  normRows.forEach(r => {
    const sid = (r.student_id || '').trim();
    if (!sid) return;
    if (!seenInFile.has(sid)) seenInFile.set(sid, []);
    seenInFile.get(sid).push(r._rowNum);
  });

  const preview = normRows.map(r => {
    const sid = (r.student_id || '').trim();
    const errors = [];
    if (!sid) errors.push('Nedostaje sifra ucenika');
    if (!(r.first_name || '').trim()) errors.push('Nedostaje ime');
    if (!(r.last_name || '').trim()) errors.push('Nedostaje prezime');
    if (!(r.class_name || '').trim()) errors.push('Nedostaje razred');

    if (sid && seenInFile.get(sid) && seenInFile.get(sid).length > 1) {
      const otherRows = seenInFile.get(sid).filter(n => n !== r._rowNum);
      errors.push(`Dupli ID u fajlu - red ${r._rowNum} i red ${otherRows[0]}`);
    }

    let status = 'new';
    let changedFields = [];
    if (errors.length > 0) {
      status = 'error';
    } else if (existingByStudentId.has(sid)) {
      status = 'update';
      const existing = existingByStudentId.get(sid);
      ['first_name', 'last_name', 'class_name', 'email'].forEach(f => {
        const newVal = (r[f] || '').trim();
        const oldVal = (existing[f] || '').trim();
        if (newVal && newVal !== oldVal) changedFields.push(`${f}: "${oldVal}" -> "${newVal}"`);
      });
    }

    const activeVal = (r.active || '').toString().trim().toLowerCase();
    const active = activeVal === '' ? true : ['true', '1', 'da', 'yes'].includes(activeVal);

    return {
      rowNum: r._rowNum, student_id: sid, first_name: r.first_name, last_name: r.last_name,
      class_name: r.class_name, email: r.email || '', active, status, errors, changedFields,
      existingId: existingByStudentId.has(sid) ? existingByStudentId.get(sid).id : null
    };
  });

  IMPORT_STATE.previewRows = preview;
  renderImportPreview();
  showImportStep('preview');
}

function renderImportPreview() {
  const preview = IMPORT_STATE.previewRows;
  const newCount = preview.filter(p => p.status === 'new').length;
  const updateCount = preview.filter(p => p.status === 'update').length;
  const errorCount = preview.filter(p => p.status === 'error').length;

  document.getElementById('import-preview-summary').textContent = `${newCount} nova, ${updateCount} azurirana, ${errorCount} greska`;
  document.getElementById('import-error-report-btn').style.display = errorCount > 0 ? 'inline-flex' : 'none';
  document.getElementById('import-confirm-btn').disabled = false;

  document.getElementById('import-preview-tbody').innerHTML = preview.map(p => {
    const badge = p.status === 'new' ? '<span class="badge badge-available">Novo</span>' :
      p.status === 'update' ? '<span class="badge badge-borrowed">Azuriranje</span>' :
      '<span class="badge badge-overdue">Greska</span>';
    const details = p.status === 'error' ? p.errors.join('; ') : p.status === 'update' && p.changedFields.length ? p.changedFields.join('; ') : '—';
    return `<tr>
      <td>${badge}</td><td>${escH(p.student_id)}</td><td>${escH(p.first_name)}</td><td>${escH(p.last_name)}</td>
      <td>${escH(p.class_name)}</td><td>${escH(p.email)}</td><td class="text-sm text-muted">${escH(details)}</td>
    </tr>`;
  }).join('');
}

function downloadImportErrorReport() {
  const errors = IMPORT_STATE.previewRows.filter(p => p.status === 'error');
  const ws = XLSX.utils.json_to_sheet(errors.map(e => ({
    'Red': e.rowNum, 'Sifra ucenika': e.student_id, 'Ime': e.first_name, 'Prezime': e.last_name,
    'Razred': e.class_name, 'Greska': e.errors.join('; ')
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Greske');
  XLSX.writeFile(wb, `IDSS_Uvoz_Greske_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function confirmImport() {
  const preview = IMPORT_STATE.previewRows;
  const toProcess = preview.filter(p => p.status !== 'error');
  const errorRows = preview.filter(p => p.status === 'error');

  if (toProcess.length === 0) {
    IDSS.toast('Nema redova za uvoz (sve su greske).', 'error');
    return;
  }

  document.getElementById('import-confirm-btn').disabled = true;
  IDSS.showLoading('Obradjujem uvezeni fajl...');
  let newCount = 0, updateCount = 0;
  try {
    for (const row of toProcess) {
      if (row.status === 'new') {
        const created = await IDSS.apiCreate('library_users', {
          id: IDSS.uid('stu-'), student_id: row.student_id, first_name: row.first_name,
          last_name: row.last_name, class_name: row.class_name, email: row.email, active: row.active
        });
        ALL_STUDENTS.push(created);
        newCount++;
      } else if (row.status === 'update') {
        const updated = await IDSS.apiUpdate('library_users', row.existingId, {
          first_name: row.first_name, last_name: row.last_name, class_name: row.class_name,
          email: row.email, active: row.active
        });
        const idx = ALL_STUDENTS.findIndex(s => s.id === row.existingId);
        if (idx >= 0) ALL_STUDENTS[idx] = updated;
        updateCount++;
      }
    }

    await IDSS.logAudit('students_bulk_imported', 'library_user', '', {
      file_name: document.getElementById('import-file-input').files[0]?.name || '',
      new_count: newCount, updated_count: updateCount, error_count: errorRows.length
    });

    const resultText = `${newCount} studenta dodano, ${updateCount} azurirana${errorRows.length > 0 ? `, ${errorRows.length} red${errorRows.length > 1 ? 'ova' : ''} preskocen${errorRows.length > 1 ? 'o' : ''} (greska)` : ''}.`;
    document.getElementById('import-result-text').textContent = resultText;
    document.getElementById('import-result-error-btn').style.display = errorRows.length > 0 ? 'inline-flex' : 'none';
    showImportStep('result');
    renderStudentsTable();
    IDSS.toast('Spisak ucenika uspjesno uvezen.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri uvozu. Neki redovi mozda nisu sacuvani.', 'error');
  } finally {
    IDSS.hideLoading();
    document.getElementById('import-confirm-btn').disabled = false;
  }
}
