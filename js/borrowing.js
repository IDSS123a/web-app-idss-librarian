/* ============================================================
   IDSS Librarian — Borrowing list + Borrow workflow
   SCAN BOOK -> SCAN STUDENT -> CONFIRM
   ============================================================ */

let ALL_BORROWINGS = [];
let ALL_BOOKS_B = [];
let ALL_COPIES_B = [];
let ALL_STUDENTS_B = [];
let SETTINGS_B = null;

(async function init() {
  renderShell('borrowing');
  await loadData();
  document.getElementById('b-search').addEventListener('input', debounceB(renderBorrowingTable, 250));
  document.getElementById('b-filter-status').addEventListener('change', renderBorrowingTable);
  document.getElementById('borrow-book-search').addEventListener('input', debounceB(searchBooksForBorrow, 200));
  document.getElementById('borrow-student-search').addEventListener('input', debounceB(searchStudentsForBorrow, 200));

  const params = new URLSearchParams(window.location.search);
  if (params.get('filter') === 'overdue') document.getElementById('b-filter-status').value = 'overdue';
  renderBorrowingTable();
})();

function debounceB(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadData() {
  IDSS.showLoading('Ucitavanje zaduzenja...');
  try {
    [ALL_BORROWINGS, ALL_BOOKS_B, ALL_COPIES_B, ALL_STUDENTS_B] = await Promise.all([
      IDSS.apiListAll('borrowings'), IDSS.apiListAll('books'), IDSS.apiListAll('book_copies'), IDSS.apiListAll('library_users')
    ]);
    const sres = await IDSS.apiList('settings', { limit: 1 });
    SETTINGS_B = (sres.data && sres.data[0]) || { default_loan_period_days: 14 };
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri ucitavanju podataka.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

function renderBorrowingTable() {
  const q = IDSS.normalize(document.getElementById('b-search').value);
  const statusFilter = document.getElementById('b-filter-status').value;

  let rows = ALL_BORROWINGS.slice().sort((a, b) => new Date(b.borrowed_at) - new Date(a.borrowed_at));

  if (statusFilter === 'active') rows = rows.filter(t => t.status === 'borrowed');
  else if (statusFilter === 'overdue') rows = rows.filter(t => t.status === 'borrowed' && IDSS.isOverdue(t.due_date, t.returned_at));

  if (q) {
    rows = rows.filter(t => IDSS.normalize([t.book_title, t.student_name, t.inventory_number, t.student_id].join(' ')).includes(q));
  }

  const tbody = document.getElementById('borrowing-tbody');
  const emptyEl = document.getElementById('borrowing-empty');
  if (rows.length === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = `<div class="empty-state"><div class="ei"><i class="fa-solid fa-right-from-bracket"></i></div><h4>Nema zaduzenja</h4><p>Trenutno nema knjiga koje odgovaraju filteru.</p></div>`;
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = rows.slice(0, 300).map(t => {
    const overdue = t.status === 'borrowed' && IDSS.isOverdue(t.due_date, t.returned_at);
    const statusLabel = t.returned_at ? '<span class="badge badge-returned">Vraceno</span>' :
      overdue ? `<span class="badge badge-overdue">Kasni ${IDSS.daysBetween(t.due_date, new Date().toISOString())}d</span>` :
      '<span class="badge badge-borrowed">Zaduzeno</span>';
    return `<tr>
      <td class="font-bold">${escapeHtmlB(t.book_title)}</td>
      <td>${escapeHtmlB(t.inventory_number)}</td>
      <td>${escapeHtmlB(t.student_name)}</td>
      <td>${escapeHtmlB(t.student_class || '—')}</td>
      <td>${IDSS.fmtDate(t.borrowed_at)}</td>
      <td>${IDSS.fmtDate(t.due_date)}</td>
      <td>${statusLabel}</td>
      <td>${!t.returned_at ? `<button class="btn btn-sm btn-primary" onclick="window.location.href='returns.html?copy=${t.copy_id}'">Vrati</button>` : '—'}</td>
    </tr>`;
  }).join('');
}

function escapeHtmlB(s) { return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* ================= BORROW FLOW ================= */
let BORROW_STATE = {};

function startBorrowFlow() {
  BORROW_STATE = {};
  document.getElementById('borrow-book-search').value = '';
  document.getElementById('borrow-student-search').value = '';
  document.getElementById('borrow-book-suggestions').innerHTML = '';
  document.getElementById('borrow-student-suggestions').innerHTML = '';
  showBorrowStep(1);
  document.getElementById('borrow-modal').classList.remove('hidden');
}
function closeBorrowModal() { document.getElementById('borrow-modal').classList.add('hidden'); }
function showBorrowStep(n) {
  [1, 2, 3, 'success'].forEach(s => document.getElementById(`borrow-step-${s}`).classList.toggle('hidden', s !== n));
}

function scanBookForBorrow() {
  openScanner({
    title: 'Skeniraj knjigu',
    subtitle: 'Skenirajte barkod ili QR kod na primjerku',
    onResult: (code) => resolveCopyForBorrow(code)
  });
}

function resolveCopyForBorrow(code) {
  const trimmed = code.trim();
  const copy = ALL_COPIES_B.find(c => c.inventory_number === trimmed || c.id === trimmed);
  if (!copy) { IDSS.toast('Primjerak nije pronadjen. Provjerite kod ili pretrazite.', 'error'); return; }
  if (copy.status === 'borrowed') { IDSS.toast('Ovaj primjerak je vec zaduzen.', 'error'); return; }
  if (copy.status === 'lost' || copy.status === 'damaged') { IDSS.toast(`Ovaj primjerak je oznacen kao "${copy.status}" i ne moze se zaduziti.`, 'error'); return; }
  const book = ALL_BOOKS_B.find(b => b.id === copy.book_id);
  BORROW_STATE.copy = copy;
  BORROW_STATE.book = book;
  document.getElementById('borrow-book-summary').innerHTML = `
    <div class="font-bold">${escapeHtmlB(book ? book.title : '')}</div>
    <div class="text-secondary text-sm">Inv. broj: ${copy.inventory_number} · ${escapeHtmlB(book ? book.author || '' : '')}</div>`;
  showBorrowStep(2);
}

function searchBooksForBorrow() {
  const q = IDSS.normalize(document.getElementById('borrow-book-search').value);
  const box = document.getElementById('borrow-book-suggestions');
  if (!q) { box.innerHTML = ''; return; }
  const bookMap = Object.fromEntries(ALL_BOOKS_B.map(b => [b.id, b]));
  const matches = ALL_COPIES_B.filter(c => {
    const b = bookMap[c.book_id] || {};
    return c.status === 'available' && IDSS.normalize([b.title, c.inventory_number].join(' ')).includes(q);
  }).slice(0, 6);
  box.innerHTML = matches.map(c => {
    const b = bookMap[c.book_id] || {};
    return `<div class="card-flat mt-8" style="cursor:pointer;" onclick='resolveCopyForBorrow("${c.inventory_number}")'>
      <div class="font-bold text-sm">${escapeHtmlB(b.title)}</div>
      <div class="text-muted text-sm">${c.inventory_number}</div>
    </div>`;
  }).join('') || `<p class="text-muted text-sm mt-8">Nema dostupnih rezultata.</p>`;
}

function scanStudentForBorrow() {
  openScanner({
    title: 'Skeniraj ucenika',
    subtitle: 'Skenirajte QR kod na dosjeu ucenika',
    onResult: (code) => resolveStudentForBorrow(code)
  });
}

function resolveStudentForBorrow(code) {
  const trimmed = code.trim();
  const student = ALL_STUDENTS_B.find(s => s.student_id === trimmed || s.id === trimmed);
  if (!student) { IDSS.toast('Ucenik nije pronadjen. Provjerite kod ili pretrazite po imenu.', 'error'); return; }
  if (student.active === false) { IDSS.toast('Ovaj ucenik je neaktivan.', 'error'); return; }
  BORROW_STATE.student = student;
  buildConfirmSummary();
  showBorrowStep(3);
}

function searchStudentsForBorrow() {
  const q = IDSS.normalize(document.getElementById('borrow-student-search').value);
  const box = document.getElementById('borrow-student-suggestions');
  if (!q) { box.innerHTML = ''; return; }
  const matches = ALL_STUDENTS_B.filter(s => s.active !== false && IDSS.normalize(`${s.first_name} ${s.last_name} ${s.student_id}`).includes(q)).slice(0, 6);
  box.innerHTML = matches.map(s => `
    <div class="card-flat mt-8" style="cursor:pointer;" onclick='resolveStudentForBorrow("${s.student_id}")'>
      <div class="font-bold text-sm">${escapeHtmlB(s.first_name + ' ' + s.last_name)}</div>
      <div class="text-muted text-sm">${escapeHtmlB(s.class_name || '')} · ${s.student_id}</div>
    </div>`).join('') || `<p class="text-muted text-sm mt-8">Nema rezultata.</p>`;
}

function buildConfirmSummary() {
  const { copy, book, student } = BORROW_STATE;
  const days = SETTINGS_B.default_loan_period_days || 14;
  const dueDate = IDSS.addDays(new Date().toISOString(), days);
  BORROW_STATE.dueDate = dueDate;
  document.getElementById('borrow-confirm-summary').innerHTML = `
    <div class="flex justify-between"><span class="text-secondary">Knjiga</span><span class="font-bold">${escapeHtmlB(book.title)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Inv. broj</span><span class="font-bold">${copy.inventory_number}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Ucenik</span><span class="font-bold">${escapeHtmlB(student.first_name + ' ' + student.last_name)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Razred</span><span class="font-bold">${escapeHtmlB(student.class_name || '—')}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Rok povrata</span><span class="font-bold">${IDSS.fmtDate(dueDate)} (${days} dana)</span></div>
  `;
}

async function confirmBorrow() {
  const { copy, book, student, dueDate } = BORROW_STATE;
  const session = IDSS.getSession();
  IDSS.showLoading('Cuvanje zaduzenja...');
  try {
    const now = new Date().toISOString();
    const borrowing = await IDSS.apiCreate('borrowings', {
      id: IDSS.uid('brw-'), copy_id: copy.id, book_id: book.id, book_title: book.title,
      inventory_number: copy.inventory_number, student_record_id: student.id, student_id: student.student_id,
      student_name: `${student.first_name} ${student.last_name}`, student_class: student.class_name || '',
      borrowed_at: now, due_date: dueDate, returned_at: '', librarian_borrowed: session.full_name,
      librarian_returned: '', status: 'borrowed'
    });
    await IDSS.apiUpdate('book_copies', copy.id, {
      status: 'borrowed', borrower_name: `${student.first_name} ${student.last_name}`,
      borrower_student_id: student.student_id, borrowed_date: now, due_date: dueDate, current_borrowing_id: borrowing.id
    });
    await IDSS.logAudit('book_borrowed', 'borrowing', borrowing.id, { book: book.title, student: student.first_name + ' ' + student.last_name });

    ALL_BORROWINGS.unshift(borrowing);
    const cIdx = ALL_COPIES_B.findIndex(c => c.id === copy.id);
    if (cIdx >= 0) Object.assign(ALL_COPIES_B[cIdx], { status: 'borrowed', due_date: dueDate });
    renderBorrowingTable();

    document.getElementById('borrow-success-detail').textContent = `${book.title} → ${student.first_name} ${student.last_name} (rok: ${IDSS.fmtDate(dueDate)})`;
    showBorrowStep('success');
    IDSS.toast('Knjiga zaduzena.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri zaduzivanju knjige.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

function exportBorrowingsExcel() {
  IDSS.showLoading('Priprema Excel fajla...');
  try {
    const rows = ALL_BORROWINGS.map(t => ({
      'Knjiga': t.book_title, 'Inventarni broj': t.inventory_number, 'Ucenik': t.student_name,
      'ID ucenika': t.student_id, 'Razred': t.student_class, 'Datum zaduzenja': IDSS.fmtDate(t.borrowed_at),
      'Rok povrata': IDSS.fmtDate(t.due_date), 'Datum povrata': t.returned_at ? IDSS.fmtDate(t.returned_at) : '',
      'Status': t.status, 'Bibliotekar (zaduzenje)': t.librarian_borrowed, 'Bibliotekar (povrat)': t.librarian_returned || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Zaduzenja');
    XLSX.writeFile(wb, `IDSS_Library_Borrowings_${new Date().toISOString().slice(0, 10)}.xlsx`);
    IDSS.logAudit('export_generated', 'borrowings', '', { rowCount: rows.length });
    IDSS.toast('Excel fajl je preuzet.', 'success');
  } finally {
    IDSS.hideLoading();
  }
}
