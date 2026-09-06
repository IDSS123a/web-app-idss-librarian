/* ============================================================
   IDSS Librarian — Return workflow
   SCAN BOOK -> CONFIRM RETURN
   ============================================================ */

let ACTIVE_BORROWINGS = [];
let ALL_COPIES_R = [];
let RETURN_STATE = {};

(async function init() {
  await renderShell('returns');
  await loadActiveBorrowings();
  document.getElementById('return-search').addEventListener('input', debounceR(searchActiveForReturn, 200));

  const params = new URLSearchParams(window.location.search);
  const copyParam = params.get('copy');
  if (copyParam) {
    const t = ACTIVE_BORROWINGS.find(x => x.copy_id === copyParam);
    if (t) openReturnConfirm(t);
  }
})();

function debounceR(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadActiveBorrowings() {
  IDSS.showLoading('Ucitavanje...');
  try {
    const all = await IDSS.apiListAll('borrowings');
    ACTIVE_BORROWINGS = all.filter(t => t.status === 'borrowed' && !t.returned_at);
    ALL_COPIES_R = await IDSS.apiListAll('book_copies');
    renderActiveList();
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri ucitavanju.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

function renderActiveList() {
  const el = document.getElementById('active-borrowings-list');
  if (ACTIVE_BORROWINGS.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="ei"><i class="fa-solid fa-book-open-reader"></i></div><h4>Nema zaduzenih knjiga</h4><p>Sve knjige su vracene.</p></div>`;
    return;
  }
  const sorted = ACTIVE_BORROWINGS.slice().sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  el.innerHTML = sorted.map(t => {
    const overdue = IDSS.isOverdue(t.due_date);
    return `<div class="flex items-center justify-between" style="padding:12px 0; border-bottom:1px solid var(--border-soft); cursor:pointer;" onclick='openReturnConfirmById("${t.id}")'>
      <div>
        <div class="font-bold text-sm">${escapeHtmlR(t.book_title)}</div>
        <div class="text-muted text-sm">${escapeHtmlR(t.student_name)} · ${escapeHtmlR(t.student_class || '')} · Inv: ${t.inventory_number}</div>
      </div>
      <div class="flex items-center gap-8">
        ${overdue ? `<span class="badge badge-overdue">Kasni ${IDSS.daysBetween(t.due_date, new Date().toISOString())}d</span>` : `<span class="badge badge-borrowed">Do ${IDSS.fmtDate(t.due_date)}</span>`}
        <button class="btn btn-sm btn-primary">Vrati</button>
      </div>
    </div>`;
  }).join('');
}

function escapeHtmlR(s) { return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

function openReturnConfirmById(id) {
  const t = ACTIVE_BORROWINGS.find(x => x.id === id);
  if (t) openReturnConfirm(t);
}

function searchActiveForReturn() {
  const q = IDSS.normalize(document.getElementById('return-search').value);
  const box = document.getElementById('return-search-results');
  if (!q) { box.innerHTML = ''; return; }
  const matches = ACTIVE_BORROWINGS.filter(t => IDSS.normalize([t.book_title, t.inventory_number, t.student_name].join(' ')).includes(q)).slice(0, 8);
  box.innerHTML = matches.map(t => `
    <div class="card-flat mt-8" style="cursor:pointer;" onclick='openReturnConfirmById("${t.id}")'>
      <div class="font-bold text-sm">${escapeHtmlR(t.book_title)}</div>
      <div class="text-muted text-sm">${escapeHtmlR(t.student_name)} · Inv: ${t.inventory_number}</div>
    </div>`).join('') || `<p class="text-muted text-sm mt-8">Nema rezultata.</p>`;
}

function scanBookForReturn() {
  openScanner({
    title: 'Skeniraj knjigu za povrat',
    subtitle: 'Skenirajte barkod ili QR kod na primjerku',
    onResult: (code) => {
      const trimmed = code.trim();
      const t = ACTIVE_BORROWINGS.find(x => x.inventory_number === trimmed);
      if (!t) {
        const copy = ALL_COPIES_R.find(c => c.inventory_number === trimmed);
        if (copy && copy.status === 'available') { IDSS.toast('Ova knjiga vec nije zaduzena.', 'info'); return; }
        IDSS.toast('Nije pronadjeno aktivno zaduzenje za ovaj primjerak.', 'error');
        return;
      }
      openReturnConfirm(t);
    }
  });
}

function openReturnConfirm(t) {
  RETURN_STATE = { borrowing: t };
  const overdue = IDSS.isOverdue(t.due_date);
  document.getElementById('return-summary').innerHTML = `
    <div class="flex justify-between"><span class="text-secondary">Knjiga</span><span class="font-bold">${escapeHtmlR(t.book_title)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Inv. broj</span><span class="font-bold">${t.inventory_number}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Ucenik</span><span class="font-bold">${escapeHtmlR(t.student_name)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Zaduzeno</span><span class="font-bold">${IDSS.fmtDate(t.borrowed_at)}</span></div>
    <div class="flex justify-between mt-8"><span class="text-secondary">Rok povrata</span><span class="font-bold">${IDSS.fmtDate(t.due_date)}</span></div>
  `;
  const banner = document.getElementById('return-overdue-banner');
  if (overdue) {
    const days = IDSS.daysBetween(t.due_date, new Date().toISOString());
    banner.classList.remove('hidden');
    banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> KASNI ${days} DANA`;
  } else {
    banner.classList.add('hidden');
  }
  document.getElementById('return-modal').classList.remove('hidden');
}
function closeReturnModal() { document.getElementById('return-modal').classList.add('hidden'); }
function closeReturnSuccessModal() { document.getElementById('return-success-modal').classList.add('hidden'); }

async function confirmReturn() {
  const t = RETURN_STATE.borrowing;
  const session = IDSS.getSession();
  IDSS.showLoading('Cuvanje povrata...');
  try {
    const now = new Date().toISOString();
    await IDSS.apiUpdate('borrowings', t.id, { returned_at: now, librarian_returned: session.full_name, status: 'returned' });
    await IDSS.apiUpdate('book_copies', t.copy_id, {
      status: 'available', borrower_name: '', borrower_student_id: '', borrowed_date: '', due_date: '', current_borrowing_id: ''
    });
    await IDSS.logAudit('book_returned', 'borrowing', t.id, { book: t.book_title, student: t.student_name });

    ACTIVE_BORROWINGS = ACTIVE_BORROWINGS.filter(x => x.id !== t.id);
    renderActiveList();
    closeReturnModal();
    document.getElementById('return-success-detail').textContent = `${t.book_title} — ${t.student_name}`;
    document.getElementById('return-success-modal').classList.remove('hidden');
    IDSS.toast('Knjiga vracena.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri vracanju knjige.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}
