/* ============================================================
   IDSS Librarian — Class bulk-borrow workflow
   A teacher borrows N copies of one textbook for a whole class at
   once (real workflow: e.g. 10 Math textbooks for grade 6, one per
   student, through the Math teacher) instead of repeating the
   single-book/single-student flow N times.
   SELECT BOOK -> SELECT CLASS + TEACHER -> PICK STUDENTS -> CONFIRM
   Reuses ALL_BOOKS_B / ALL_COPIES_B / ALL_STUDENTS_B / SETTINGS_B
   already loaded by js/borrowing.js on this page.
   ============================================================ */

let CB_STATE = {};
let CB_TEACHERS = null; // lazy-loaded, cached for the session

function startClassBorrowFlow() {
  CB_STATE = {};
  document.getElementById('cb-book-search').value = '';
  document.getElementById('cb-book-suggestions').innerHTML = '';
  showClassBorrowStep(1);
  document.getElementById('class-borrow-modal').classList.remove('hidden');
}
function closeClassBorrowModal() { document.getElementById('class-borrow-modal').classList.add('hidden'); }
function showClassBorrowStep(n) {
  [1, 2, 3, 'success'].forEach(s => document.getElementById(`cb-step-${s}`).classList.toggle('hidden', s !== n));
}

// This script tag is at the end of <body>, after the elements it references,
// so the DOM is already there — no need to wait for DOMContentLoaded (which
// may well have already fired by the time this file runs).
document.getElementById('cb-book-search').addEventListener('input', debounceB(searchBooksForClassBorrow, 200));

function searchBooksForClassBorrow() {
  const q = IDSS.normalize(document.getElementById('cb-book-search').value);
  const box = document.getElementById('cb-book-suggestions');
  if (!q) { box.innerHTML = ''; return; }
  const matches = ALL_BOOKS_B.filter(b => IDSS.normalize([b.title, b.isbn].join(' ')).includes(q)).slice(0, 8);
  box.innerHTML = matches.map(b => {
    const available = ALL_COPIES_B.filter(c => c.book_id === b.id && c.status === 'available').length;
    return `<div class="card-flat mt-8" style="cursor:${available > 0 ? 'pointer' : 'default'}; opacity:${available > 0 ? 1 : 0.5};" ${available > 0 ? `onclick='selectBookForClassBorrow("${b.id}")'` : ''}>
      <div class="font-bold text-sm">${escapeHtmlB(b.title)}</div>
      <div class="text-muted text-sm">${escapeHtmlB(b.author || '')} · ${available} dostupno</div>
    </div>`;
  }).join('') || `<p class="text-muted text-sm mt-8">Nema rezultata.</p>`;
}

async function selectBookForClassBorrow(bookId) {
  const book = ALL_BOOKS_B.find(b => b.id === bookId);
  const available = ALL_COPIES_B.filter(c => c.book_id === bookId && c.status === 'available');
  if (available.length === 0) { IDSS.toast('Nema dostupnih primjeraka ove knjige.', 'error'); return; }
  CB_STATE.book = book;
  CB_STATE.availableCopies = available;
  document.getElementById('cb-book-summary').innerHTML = `
    <div class="font-bold">${escapeHtmlB(book.title)}</div>
    <div class="text-secondary text-sm">${escapeHtmlB(book.author || '')} · ${available.length} dostupno na stanju</div>`;

  // Populate class dropdown from distinct class_name among active students
  const classes = Array.from(new Set(ALL_STUDENTS_B.filter(s => s.active !== false && s.class_name).map(s => s.class_name))).sort();
  document.getElementById('cb-class-select').innerHTML = classes.length
    ? classes.map(c => `<option value="${escapeHtmlB(c)}">${escapeHtmlB(c)}</option>`).join('')
    : `<option value="">(nema razreda sa aktivnim ucenicima)</option>`;

  await loadTeachersForClassBorrow();
  showClassBorrowStep(2);
}

async function loadTeachersForClassBorrow() {
  if (!CB_TEACHERS) CB_TEACHERS = (await IDSS.apiListAll('staff')).filter(s => s.role === 'teacher' && s.active !== false);
  const sel = document.getElementById('cb-teacher-select');
  sel.innerHTML = CB_TEACHERS.length
    ? CB_TEACHERS.map(t => `<option value="${t.id}">${escapeHtmlB(t.full_name)}${t.subject ? ' — ' + escapeHtmlB(t.subject) : ''}${t.grade ? ' (razred ' + escapeHtmlB(t.grade) + ')' : ''}</option>`).join('')
    : `<option value="">(nema unesenih nastavnika — dodajte ih u Podesavanjima)</option>`;
}

function loadClassStudentsForBorrow() {
  const className = document.getElementById('cb-class-select').value;
  const teacherId = document.getElementById('cb-teacher-select').value;
  if (!className) { IDSS.toast('Izaberite razred.', 'error'); return; }
  if (!teacherId) { IDSS.toast('Izaberite nastavnika. Ako lista nastavnika ne postoji, dodajte ih na Podesavanjima.', 'error'); return; }

  CB_STATE.className = className;
  CB_STATE.teacher = CB_TEACHERS.find(t => t.id === teacherId);

  const students = ALL_STUDENTS_B.filter(s => s.active !== false && s.class_name === className)
    .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
  if (students.length === 0) { IDSS.toast('Nema aktivnih ucenika u ovom razredu.', 'error'); return; }
  CB_STATE.classStudents = students;

  document.getElementById('cb-summary-3').innerHTML = `
    <div class="flex justify-between"><span class="text-secondary">Udzbenik</span><span class="font-bold">${escapeHtmlB(CB_STATE.book.title)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Razred</span><span class="font-bold">${escapeHtmlB(className)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Nastavnik</span><span class="font-bold">${escapeHtmlB(CB_STATE.teacher.full_name)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Dostupno primjeraka</span><span class="font-bold">${CB_STATE.availableCopies.length}</span></div>
  `;

  document.getElementById('cb-student-checklist').innerHTML = students.map(s => `
    <label class="flex items-center gap-8" style="padding:8px 0; border-bottom:1px solid var(--border-soft); cursor:pointer;">
      <input type="checkbox" class="cb-student-check" value="${s.id}" checked onchange="updateClassBorrowCount()">
      <span>${escapeHtmlB(s.first_name)} ${escapeHtmlB(s.last_name)}</span>
      <span class="text-muted text-sm">${escapeHtmlB(s.student_id)}</span>
    </label>`).join('');

  updateClassBorrowCount();
  showClassBorrowStep(3);
}

function updateClassBorrowCount() {
  const checked = document.querySelectorAll('.cb-student-check:checked').length;
  const available = CB_STATE.availableCopies.length;
  const over = checked > available;
  document.getElementById('cb-select-count').innerHTML =
    `<span class="${over ? 'text-danger' : ''}" style="${over ? 'color:var(--idss-red); font-weight:700;' : ''}">${checked} od ${CB_STATE.classStudents.length} odabrano</span> — ${available} primjerak${available === 1 ? '' : 'a'} dostupno${over ? ' — PREVISE ODABRANO, smanjite izbor ili dodajte jos primjeraka.' : ''}`;
  document.getElementById('cb-confirm-btn').disabled = checked === 0 || over;
}

async function confirmClassBorrow() {
  const checkedIds = Array.from(document.querySelectorAll('.cb-student-check:checked')).map(el => el.value);
  if (checkedIds.length === 0) { IDSS.toast('Izaberite bar jednog ucenika.', 'error'); return; }
  if (checkedIds.length > CB_STATE.availableCopies.length) { IDSS.toast('Odabrano je vise ucenika nego sto ima dostupnih primjeraka.', 'error'); return; }

  const btn = document.getElementById('cb-confirm-btn');
  btn.disabled = true;
  IDSS.showLoading(`Zaduzujem ${checkedIds.length} primjerak(a)...`);
  const session = IDSS.getSession();
  const days = SETTINGS_B.default_loan_period_days || 14;
  const dueDate = IDSS.addDays(new Date().toISOString(), days);
  const now = new Date().toISOString();
  const { book, teacher, className } = CB_STATE;
  let done = 0;
  try {
    for (let i = 0; i < checkedIds.length; i++) {
      const student = CB_STATE.classStudents.find(s => s.id === checkedIds[i]);
      const copy = CB_STATE.availableCopies[i];
      const borrowing = await IDSS.apiCreate('borrowings', {
        id: IDSS.uid('brw-'), copy_id: copy.id, book_id: book.id, book_title: book.title,
        inventory_number: copy.inventory_number, student_record_id: student.id, student_id: student.student_id,
        student_name: `${student.first_name} ${student.last_name}`, student_class: student.class_name || className,
        borrowed_at: now, due_date: dueDate, returned_at: '', librarian_borrowed: session.full_name,
        librarian_returned: '', status: 'borrowed', teacher_id: teacher.id, teacher_name: teacher.full_name
      });
      await IDSS.apiUpdate('book_copies', copy.id, {
        status: 'borrowed', borrower_name: `${student.first_name} ${student.last_name}`,
        borrower_student_id: student.student_id, borrowed_date: now, due_date: dueDate, current_borrowing_id: borrowing.id
      });
      await IDSS.logAudit('book_borrowed', 'borrowing', borrowing.id, {
        book: book.title, student: student.first_name + ' ' + student.last_name, teacher: teacher.full_name, via: 'class_bulk_borrow'
      });
      ALL_BORROWINGS.unshift(borrowing);
      const cIdx = ALL_COPIES_B.findIndex(c => c.id === copy.id);
      if (cIdx >= 0) Object.assign(ALL_COPIES_B[cIdx], { status: 'borrowed', due_date: dueDate });
      done++;
    }
    renderBorrowingTable();
    document.getElementById('cb-success-detail').textContent =
      `${book.title} → ${done} ucenik${done === 1 ? '' : done < 5 ? 'a' : 'a'} razreda ${className}, preko nastavnika ${teacher.full_name} (rok: ${IDSS.fmtDate(dueDate)})`;
    showClassBorrowStep('success');
    IDSS.toast(`${done} primjerak(a) zaduzeno.`, 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast(`Greska nakon ${done} od ${checkedIds.length} uspjesnih zaduzenja — provjerite listu prije ponovnog pokusaja.`, 'error');
  } finally {
    btn.disabled = false;
    IDSS.hideLoading();
  }
}
