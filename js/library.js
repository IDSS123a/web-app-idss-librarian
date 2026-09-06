/* ============================================================
   IDSS Librarian — Library inventory + Add Book workflow
   ============================================================ */

let ALL_BOOKS = [];
let ALL_COPIES = [];
let ALL_CATEGORIES = [];
let FILTERED_ROWS = [];
let CURRENT_PAGE = 1;
const PAGE_SIZE = 15;

(async function init() {
  renderShell('library');
  await loadCategories();
  await loadInventory();

  document.getElementById('search-input').addEventListener('input', debounce(applyFilters, 250));
  document.getElementById('filter-category').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('export-btn').addEventListener('click', exportLibraryExcel);
  document.getElementById('add-book-btn').addEventListener('click', openAddBookModal);

  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'add') openAddBookModal();
})();

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function loadCategories() {
  ALL_CATEGORIES = await IDSS.apiListAll('categories');
  const sel = document.getElementById('filter-category');
  ALL_CATEGORIES.filter(c => c.active !== false).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name; opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

async function loadInventory() {
  IDSS.showLoading('Ucitavanje inventara...');
  try {
    ALL_BOOKS = await IDSS.apiListAll('books');
    ALL_COPIES = await IDSS.apiListAll('book_copies');
    applyFilters();
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri ucitavanju biblioteke.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

function buildRows() {
  const bookMap = Object.fromEntries(ALL_BOOKS.map(b => [b.id, b]));
  return ALL_COPIES.map(c => {
    const b = bookMap[c.book_id] || {};
    return { copy: c, book: b };
  });
}

// ---------- Physical shelf order: kategorija (sort_order) -> predmet -> razred -> naslov ----------
// Director's choice (not invented here): category order = the existing
// seeded order (categories.sort_order); within a category, subject -> grade
// -> title. This is the same order used on-screen (default sort below) and
// in the "Fizicki raspored" export (reports.js), so the two always agree.
function categorySortOrder(name) {
  const cat = ALL_CATEGORIES.find(c => c.name === name);
  return (cat && typeof cat.sort_order === 'number') ? cat.sort_order : 99;
}

// Natural sort for grade text ("5", "7B", "" ...): numeric prefix first,
// blanks sort last so ungraded items don't scatter through the middle.
function gradeSortKey(grade) {
  if (!grade) return [1, Number.MAX_SAFE_INTEGER, ''];
  const m = String(grade).match(/^(\d+)/);
  return m ? [0, parseInt(m[1], 10), grade] : [0, Number.MAX_SAFE_INTEGER - 1, grade];
}

function comparePhysicalOrder(rowA, rowB) {
  const catDiff = categorySortOrder(rowA.book.category) - categorySortOrder(rowB.book.category);
  if (catDiff) return catDiff;
  const subjDiff = (rowA.copy.subject || '').localeCompare(rowB.copy.subject || '');
  if (subjDiff) return subjDiff;
  const gA = gradeSortKey(rowA.copy.grade), gB = gradeSortKey(rowB.copy.grade);
  if (gA[0] !== gB[0]) return gA[0] - gB[0];
  if (gA[1] !== gB[1]) return gA[1] - gB[1];
  return (rowA.book.title || '').localeCompare(rowB.book.title || '');
}

function applyFilters() {
  const q = IDSS.normalize(document.getElementById('search-input').value);
  const cat = document.getElementById('filter-category').value;
  const status = document.getElementById('filter-status').value;

  let rows = buildRows();

  if (cat) rows = rows.filter(r => r.book.category === cat);
  if (status) rows = rows.filter(r => r.copy.status === status);

  if (q) {
    rows = rows.filter(r => {
      const hay = IDSS.normalize([
        r.book.title, r.book.author, r.book.isbn, r.copy.inventory_number, r.book.category
      ].join(' '));
      return hay.includes(q);
    });
  }

  rows.sort(comparePhysicalOrder);

  FILTERED_ROWS = rows;
  CURRENT_PAGE = 1;
  renderTable();
  document.getElementById('inv-count-sub').textContent = `${ALL_COPIES.length} primjeraka · ${ALL_BOOKS.length} naslova u biblioteci`;
}

function renderTable() {
  const tbody = document.getElementById('library-tbody');
  const emptyEl = document.getElementById('library-empty');
  const total = FILTERED_ROWS.length;
  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageRows = FILTERED_ROWS.slice(start, start + PAGE_SIZE);

  if (total === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = `<div class="empty-state"><div class="ei"><i class="fa-solid fa-book"></i></div>
      <h4>${ALL_COPIES.length === 0 ? 'Vasa biblioteka je prazna' : 'Nema rezultata'}</h4>
      <p>${ALL_COPIES.length === 0 ? 'Skenirajte prvu knjigu da pocnete.' : 'Pokusajte drugaciju pretragu ili filter.'}</p>
      ${ALL_COPIES.length === 0 ? '<button class="btn btn-primary" onclick="openAddBookModal()"><i class="fa-solid fa-barcode"></i> Skeniraj prvu knjigu</button>' : ''}
      </div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = pageRows.map(r => {
    const c = r.copy, b = r.book;
    const statusBadge = renderStatusBadge(c.status, c.due_date);
    return `<tr onclick="openBookDetail('${b.id}')">
      <td class="font-bold">${c.inventory_number || '—'}</td>
      <td>${escapeHtml(b.title || '(bez naziva)')}</td>
      <td>${escapeHtml(b.author || '—')}</td>
      <td>${escapeHtml(b.category || '—')}</td>
      <td>${escapeHtml(c.subject || '—')}</td>
      <td>${escapeHtml(c.grade || '—')}</td>
      <td>${escapeHtml(b.isbn || '—')}</td>
      <td>${escapeHtml(c.shelf_location || '—')}</td>
      <td>${statusBadge}</td>
      <td>${c.borrower_name || '—'}</td>
      <td>${c.status === 'borrowed' ? IDSS.fmtDate(c.due_date) : '—'}</td>
    </tr>`;
  }).join('');

  renderPagination(total);
}

function renderStatusBadge(status, dueDate) {
  const map = {
    available: ['badge-available', 'Dostupno'],
    borrowed: IDSS.isOverdue(dueDate) ? ['badge-overdue', 'Kasni'] : ['badge-borrowed', 'Zaduzeno'],
    lost: ['badge-lost', 'Izgubljeno'],
    damaged: ['badge-damaged', 'Osteceno']
  };
  const [cls, label] = map[status] || ['badge-lost', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderPagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = `<button ${CURRENT_PAGE === 1 ? 'disabled' : ''} onclick="gotoPage(${CURRENT_PAGE - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - CURRENT_PAGE) <= 1) {
      html += `<button class="${i === CURRENT_PAGE ? 'active' : ''}" onclick="gotoPage(${i})">${i}</button>`;
    } else if (Math.abs(i - CURRENT_PAGE) === 2) {
      html += `<span class="text-muted">...</span>`;
    }
  }
  html += `<button ${CURRENT_PAGE === pages ? 'disabled' : ''} onclick="gotoPage(${CURRENT_PAGE + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
  el.innerHTML = html;
}
function gotoPage(p) { CURRENT_PAGE = p; renderTable(); }

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* =====================================================================
   ADD BOOK WORKFLOW
   Steps: entry -> (scan isbn | scan cover | manual) -> confirm found ->
          duplicate check -> details -> save
   ===================================================================== */

let ADD_BOOK_STATE = {};
let LAST_COPY_DEFAULTS = { category: '', subject: '', grade: '', shelf: '', condition: 'dobro' };

function openAddBookModal() {
  ADD_BOOK_STATE = {};
  showStep('entry');
  document.getElementById('add-book-modal').classList.remove('hidden');
}
function closeAddBookModal() {
  document.getElementById('add-book-modal').classList.add('hidden');
}
function showStep(step) {
  ['entry', 'searching', 'cover', 'confirm-found', 'duplicate', 'details'].forEach(s => {
    document.getElementById(`add-book-step-${s}`).classList.toggle('hidden', s !== step);
  });
}
function backToEntry() { showStep('entry'); }

// Continuous rapid-add loop: adding "desetine knjiga" via barcode should
// need one tap per book, not one tap per book PLUS re-opening "Dodaj knjigu"
// each time. Every ISBN scan (first one from the entry menu, or a repeat)
// sets viaScan=true; after a successful save the scanner reopens on its own
// (see saveBookAndCopies) — "Zatvori" on the scanner is what ends the loop.
function startScanIsbn() {
  ADD_BOOK_STATE.viaScan = true;
  document.getElementById('add-book-modal').classList.remove('hidden');
  openScanner({
    title: 'Skeniraj ISBN',
    subtitle: 'Usmjerite kameru na barkod (EAN-13) na poledjini knjige',
    onResult: async (code) => {
      showStep('searching');
      document.getElementById('searching-msg').textContent = 'Trazim informacije o knjizi...';
      await handleIsbnResult(code);
    }
  });
}

function continueScanLoop() {
  ADD_BOOK_STATE = {};
  startScanIsbn();
}

function startManualEntry() {
  ADD_BOOK_STATE = { manual: true, isbn: '', book: {} };
  renderManualFields({});
  showStep('details');
  document.getElementById('details-book-summary').textContent = 'Unesite podatke o knjizi rucno.';
}

function startScanCover() {
  showStep('cover');
  document.getElementById('cover-preview').innerHTML = '';
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'cover-file-input') {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      document.getElementById('cover-preview').innerHTML = `<img src="${url}" style="max-width:100%; border-radius:10px; margin-top:10px;">`;
      ADD_BOOK_STATE.coverFile = file;
    }
  }
});

// Cover OCR is inherently the slowest, least reliable way to add a book
// (decorative cover typography, first-use language-model download over
// whatever network the phone has, no timeout of its own) — it must never
// be able to freeze the app regardless of how badly it's going. A hard
// wall-clock timeout + a visible cancel button guarantee that; the
// progress readout replaces the old static "Prepoznajem..." text so a
// slow-but-working attempt doesn't look identical to a stuck one.
// Language is deliberately 'eng' only (not 'eng+deu'): a second trained-data
// model roughly doubles both the download and the recognition time for
// text this app only uses as a rough guess anyway (verified afterwards
// against a real catalog) — Latin-alphabet OCR still reads German/French/
// Bosnian titles reasonably even without their own language model, and for
// a bulk-add workflow speed matters more here than a few extra percent of
// per-character accuracy.
const OCR_TIMEOUT_MS = 25000;
let _ocrWorker = null;
let _ocrTimeoutId = null;
let _ocrTimedOut = false;

function setSearchingMsg(msg) {
  const el = document.getElementById('searching-msg');
  if (el) el.textContent = msg;
}

async function terminateOcrWorker() {
  const w = _ocrWorker;
  _ocrWorker = null;
  if (w) { try { await w.terminate(); } catch (e) { /* already gone */ } }
}

function cancelSearching() {
  clearTimeout(_ocrTimeoutId);
  _ocrTimedOut = true;
  terminateOcrWorker();
  IDSS.toast('Prekinuto.', 'info');
  backToEntry();
}

async function runCoverOcr() {
  const file = ADD_BOOK_STATE.coverFile;
  if (!file) { IDSS.toast('Izaberite fotografiju naslovnice.', 'error'); return; }
  showStep('searching');
  document.getElementById('searching-cancel-btn').classList.remove('hidden');
  setSearchingMsg('Pokrecem prepoznavanje teksta...');

  _ocrTimedOut = false;
  clearTimeout(_ocrTimeoutId);
  _ocrTimeoutId = setTimeout(async () => {
    _ocrTimedOut = true;
    await terminateOcrWorker();
    IDSS.toast(`Prepoznavanje je predugo trajalo (${OCR_TIMEOUT_MS / 1000}s) i prekinuto je — unesite podatke rucno ili skenirajte ISBN.`, 'error');
    startManualEntry();
  }, OCR_TIMEOUT_MS);

  try {
    _ocrWorker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (_ocrTimedOut) return;
        if (m.status === 'recognizing text') setSearchingMsg(`Prepoznajem tekst... ${Math.round((m.progress || 0) * 100)}%`);
        else if (m.status === 'loading language traineddata') setSearchingMsg('Preuzimam OCR podatke (prvi put je sporije)...');
        else if (m.status) setSearchingMsg(m.status.charAt(0).toUpperCase() + m.status.slice(1) + '...');
      }
    });
    const result = await _ocrWorker.recognize(file);
    if (_ocrTimedOut) return; // timeout already handled this attempt
    clearTimeout(_ocrTimeoutId);
    await terminateOcrWorker();

    const text = (result.data && result.data.text || '').trim();
    const guess = guessTitleAuthor(text);
    if (!guess.title) {
      IDSS.toast('Nije moguce prepoznati naslov. Unesite rucno.', 'info');
      startManualEntry();
      return;
    }
    setSearchingMsg('Trazim po prepoznatom naslovu...');
    // Try Google Books text search by guessed title/author
    const q = encodeURIComponent(`${guess.title} ${guess.author || ''}`.trim());
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}`);
    const data = await res.json();
    if (data.totalItems > 0 && data.items[0]) {
      const v = data.items[0].volumeInfo || {};
      const isbnObj = (v.industryIdentifiers || []).find(i => i.type === 'ISBN_13') || (v.industryIdentifiers || [])[0];
      ADD_BOOK_STATE.isbn = isbnObj ? isbnObj.identifier : '';
      ADD_BOOK_STATE.book = {
        title: v.title || guess.title,
        subtitle: v.subtitle || '',
        author: (v.authors || []).join(', ') || guess.author || '',
        publisher: v.publisher || '',
        publication_year: extractYearLocal(v.publishedDate),
        language: (v.language || '').toUpperCase(),
        page_count: v.pageCount || null,
        description: v.description || '',
        cover_url: (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || ''
      };
      showConfirmFound(true);
    } else {
      IDSS.toast('Knjiga nije pronadjena automatski. Provjerite ili unesite rucno.', 'info');
      ADD_BOOK_STATE.book = { title: guess.title, author: guess.author || '' };
      ADD_BOOK_STATE.lowConfidence = true;
      showConfirmFound(false);
    }
  } catch (e) {
    if (_ocrTimedOut) return;
    clearTimeout(_ocrTimeoutId);
    await terminateOcrWorker();
    console.error(e);
    IDSS.toast('Prepoznavanje naslovnice nije uspjelo. Unesite rucno.', 'error');
    startManualEntry();
  } finally {
    document.getElementById('searching-cancel-btn').classList.add('hidden');
  }
}

function extractYearLocal(d) { if (!d) return null; const m = String(d).match(/\d{4}/); return m ? parseInt(m[0]) : null; }

function guessTitleAuthor(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lines.length === 0) return { title: '', author: '' };
  // Heuristic: longest early line = title; a later short line = author
  const title = lines.sort((a, b) => b.length - a.length)[0];
  const author = lines.find(l => l !== title && l.length < 40) || '';
  return { title, author };
}

async function handleIsbnResult(code) {
  const result = await lookupIsbn(code);
  ADD_BOOK_STATE.isbn = result.isbn;
  if (result.found) {
    ADD_BOOK_STATE.book = result.book;
    showConfirmFound(true);
  } else {
    IDSS.toast('ISBN nije pronadjen u bazama. Unesite podatke rucno.', 'info');
    ADD_BOOK_STATE.book = {};
    ADD_BOOK_STATE.manual = true;
    renderManualFields({ isbn: result.isbn });
    showStep('details');
    document.getElementById('details-book-summary').textContent = `ISBN ${result.isbn} nije pronadjen automatski — unesite podatke rucno.`;
  }
}

function showConfirmFound(highConfidence) {
  const b = ADD_BOOK_STATE.book;
  document.getElementById('confirm-book-title').textContent = b.title || '(nepoznat naslov)';
  document.getElementById('confirm-book-meta').textContent = [b.author, b.publisher, b.publication_year].filter(Boolean).join(' · ') || (highConfidence ? '' : 'Niska pouzdanost prepoznavanja — provjerite paznjivo.');
  const img = document.getElementById('confirm-cover-img');
  if (b.cover_url) { img.src = b.cover_url; img.style.display = 'block'; } else { img.style.display = 'none'; }
  showStep('confirm-found');
}

function proceedToDetails(forceAddCopy) {
  // Duplicate detection: check if a book with same ISBN already exists
  const isbn = ADD_BOOK_STATE.isbn;
  const existing = isbn ? ALL_BOOKS.find(b => b.isbn && cleanIsbn(b.isbn) === cleanIsbn(isbn)) : null;

  if (existing && !forceAddCopy && !ADD_BOOK_STATE.dupChecked) {
    const copiesCount = ALL_COPIES.filter(c => c.book_id === existing.id).length;
    ADD_BOOK_STATE.existingBookId = existing.id;
    document.getElementById('duplicate-info').textContent = `"${existing.title}" vec postoji sa ${copiesCount} primjerak(a) u biblioteci.`;
    showStep('duplicate');
    return;
  }

  ADD_BOOK_STATE.dupChecked = true;
  const b = ADD_BOOK_STATE.book || {};
  document.getElementById('manual-fields-wrap').innerHTML = '';
  document.getElementById('details-book-summary').textContent = `${b.title || ''} ${b.author ? '· ' + b.author : ''}`;

  // populate category select — prefilled from the last-saved copy so a
  // back-to-back batch (e.g. 30 German-class textbooks for the same shelf)
  // doesn't need the same fields retyped every single time.
  const catSel = document.getElementById('copy-category');
  catSel.innerHTML = ALL_CATEGORIES.filter(c => c.active !== false).map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  if (LAST_COPY_DEFAULTS.category) catSel.value = LAST_COPY_DEFAULTS.category;
  document.getElementById('copy-subject').value = LAST_COPY_DEFAULTS.subject;
  document.getElementById('copy-grade').value = LAST_COPY_DEFAULTS.grade;
  document.getElementById('copy-shelf').value = LAST_COPY_DEFAULTS.shelf;
  document.getElementById('copy-condition').value = LAST_COPY_DEFAULTS.condition;
  document.getElementById('copy-quantity').value = 1;
  document.getElementById('copy-price').value = '';
  document.getElementById('copy-notes').value = '';
  showStep('details');
}

function viewExistingBook() {
  closeAddBookModal();
  openBookDetail(ADD_BOOK_STATE.existingBookId);
}

function renderManualFields(prefill) {
  const catOptions = ALL_CATEGORIES.filter(c => c.active !== false).map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  document.getElementById('manual-fields-wrap').innerHTML = `
    <div class="field"><label>Naslov *</label><input class="input" id="m-title" value="${escapeHtml(prefill.title||'')}"></div>
    <div class="field"><label>Autor</label><input class="input" id="m-author" value="${escapeHtml(prefill.author||'')}"></div>
    <div class="field"><label>ISBN</label><input class="input" id="m-isbn" value="${escapeHtml(prefill.isbn||'')}"></div>
    <div class="field"><label>Izdavac</label><input class="input" id="m-publisher"></div>
    <div class="field"><label>Godina izdanja</label><input class="input" type="number" id="m-year"></div>
    <div class="field"><label>Jezik</label><input class="input" id="m-language" placeholder="npr. DE, BS, EN"></div>
  `;
  const catSel = document.getElementById('copy-category');
  catSel.innerHTML = catOptions;
  document.getElementById('copy-subject').value = '';
  document.getElementById('copy-grade').value = '';
  document.getElementById('copy-shelf').value = '';
  document.getElementById('copy-quantity').value = 1;
  document.getElementById('copy-price').value = '';
  document.getElementById('copy-notes').value = '';
}

function cleanIsbn(raw) { return (raw || '').replace(/[^0-9Xx]/g, '').toUpperCase(); }

async function saveBookAndCopies() {
  const btn = document.getElementById('save-book-btn');
  btn.disabled = true;
  IDSS.showLoading('Cuvanje knjige...');
  try {
    let bookId = ADD_BOOK_STATE.existingBookId;

    if (!bookId) {
      let bookData;
      if (ADD_BOOK_STATE.manual) {
        const title = document.getElementById('m-title').value.trim();
        if (!title) { IDSS.toast('Naslov je obavezan.', 'error'); btn.disabled = false; IDSS.hideLoading(); return; }
        bookData = {
          title,
          author: document.getElementById('m-author').value.trim(),
          isbn: document.getElementById('m-isbn').value.trim(),
          publisher: document.getElementById('m-publisher').value.trim(),
          publication_year: parseInt(document.getElementById('m-year').value) || null,
          language: document.getElementById('m-language').value.trim(),
          subtitle: '', page_count: null, description: '', cover_url: ''
        };
      } else {
        bookData = Object.assign({ isbn: ADD_BOOK_STATE.isbn }, ADD_BOOK_STATE.book);
      }

      // Final safety-net duplicate check — covers every path that can reach
      // this point (manual entry, ISBN-not-found-in-any-catalog, etc.), not
      // just the scan-ISBN happy path that proceedToDetails() already checks
      // earlier. A librarian must never be able to silently create a second
      // book record for an ISBN that's already in the library.
      const dupIsbn = (bookData.isbn || '').trim();
      if (dupIsbn) {
        const dup = ALL_BOOKS.find(b => b.isbn && cleanIsbn(b.isbn) === cleanIsbn(dupIsbn));
        if (dup) {
          btn.disabled = false;
          IDSS.hideLoading();
          ADD_BOOK_STATE.existingBookId = dup.id;
          const copiesCount = ALL_COPIES.filter(c => c.book_id === dup.id).length;
          document.getElementById('duplicate-info').textContent = `"${dup.title}" vec postoji sa ${copiesCount} primjerak(a) u biblioteci (ISBN ${dupIsbn}).`;
          showStep('duplicate');
          IDSS.toast('Ova knjiga vec postoji u biblioteci — provjerite prije dodavanja.', 'error');
          return;
        }
      }

      bookData.category = document.getElementById('copy-category').value;
      const session = IDSS.getSession();
      const created = await IDSS.apiCreate('books', Object.assign({ id: IDSS.uid('book-') }, bookData, { created_by: session.full_name }));
      bookId = created.id;
      ALL_BOOKS.push(created);
      await IDSS.logAudit('book_created', 'book', bookId, { title: bookData.title, isbn: bookData.isbn });
    }

    const qty = Math.max(1, parseInt(document.getElementById('copy-quantity').value) || 1);
    const subject = document.getElementById('copy-subject').value.trim();
    const grade = document.getElementById('copy-grade').value.trim();
    const shelf = document.getElementById('copy-shelf').value.trim();
    const condition = document.getElementById('copy-condition').value;
    const notes = document.getElementById('copy-notes').value.trim();
    const priceRaw = document.getElementById('copy-price').value;
    const price = priceRaw !== '' ? parseFloat(priceRaw) : null;

    const settings = await getSettingsCached();
    let seq = settings.next_inventory_seq || 1;
    const newCopies = [];
    for (let i = 0; i < qty; i++) {
      const invNumber = `${settings.inventory_prefix || 'IDSS-LIB-'}${String(seq).padStart(6, '0')}`;
      seq++;
      const copy = await IDSS.apiCreate('book_copies', {
        id: IDSS.uid('copy-'), book_id: bookId, inventory_number: invNumber,
        subject, grade, shelf_location: shelf, condition, status: 'available',
        notes, added_date: new Date().toISOString(), purchase_price: price
      });
      newCopies.push(copy);
      await IDSS.logAudit('copy_added', 'book_copy', copy.id, { inventory_number: invNumber, book_id: bookId });
    }
    await IDSS.apiUpdate('settings', settings.id, { next_inventory_seq: seq });

    ALL_COPIES = ALL_COPIES.concat(newCopies);
    applyFilters();
    LAST_COPY_DEFAULTS = { category: document.getElementById('copy-category').value, subject, grade, shelf, condition };

    if (ADD_BOOK_STATE.viaScan) {
      // Rapid-add loop: hide the details form and jump straight back into
      // the barcode scanner for the next book. "Zatvori" on the scanner
      // (or the "X primjeraka" toast alone, if they walk away) ends it.
      document.getElementById('add-book-modal').classList.add('hidden');
      IDSS.toast(`Dodano: ${ADD_BOOK_STATE.book && ADD_BOOK_STATE.book.title || 'knjiga'} (${qty} primjerak${qty > 1 ? 'a' : ''}). Skeniraj sljedecu...`, 'success');
      setTimeout(continueScanLoop, 450);
    } else {
      closeAddBookModal();
      IDSS.toast(`Knjiga dodana (${qty} primjerak${qty > 1 ? 'a' : ''}).`, 'success');
    }
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri cuvanju knjige.', 'error');
  } finally {
    btn.disabled = false;
    IDSS.hideLoading();
  }
}

let _settingsCache = null;
async function getSettingsCached() {
  if (_settingsCache) return _settingsCache;
  const res = await IDSS.apiList('settings', { limit: 1 });
  _settingsCache = (res.data && res.data[0]) || { id: 'default', inventory_prefix: 'IDSS-LIB-', next_inventory_seq: 1 };
  return _settingsCache;
}

/* =====================================================================
   BOOK DETAIL MODAL
   ===================================================================== */

async function openBookDetail(bookId) {
  const book = ALL_BOOKS.find(b => b.id === bookId);
  if (!book) return;
  const copies = ALL_COPIES.filter(c => c.book_id === bookId);
  const available = copies.filter(c => c.status === 'available').length;
  const borrowed = copies.filter(c => c.status === 'borrowed').length;

  document.getElementById('book-detail-content').innerHTML = `
    <div class="flex gap-16" style="align-items:flex-start;">
      ${book.cover_url ? `<img src="${book.cover_url}" style="width:110px; border-radius:10px; box-shadow:var(--shadow-out-sm);">` : `<div style="width:110px;height:150px;border-radius:10px;background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:30px;"><i class="fa-solid fa-book"></i></div>`}
      <div style="flex:1;">
        <h3 style="margin:0 0 4px;">${escapeHtml(book.title)}</h3>
        <p class="text-secondary" style="margin:0 0 10px;">${escapeHtml(book.author || '')}</p>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <span class="tag-chip">${escapeHtml(book.category || '—')}</span>
          <span class="tag-chip">ISBN: ${escapeHtml(book.isbn || '—')}</span>
          <span class="tag-chip">${escapeHtml(book.publisher || '')} ${book.publication_year || ''}</span>
          <span class="tag-chip">${escapeHtml(book.language || '')}</span>
        </div>
        <div class="flex gap-16 mt-16">
          <div><div class="stat-value" style="font-size:20px;">${copies.length}</div><div class="stat-label">Ukupno</div></div>
          <div><div class="stat-value" style="font-size:20px; color:#17803d;">${available}</div><div class="stat-label">Dostupno</div></div>
          <div><div class="stat-value" style="font-size:20px; color:#92600a;">${borrowed}</div><div class="stat-label">Zaduzeno</div></div>
        </div>
      </div>
    </div>
    ${book.description ? `<p class="text-secondary text-sm mt-16">${escapeHtml(book.description).slice(0, 400)}</p>` : ''}
    <div class="mt-24 flex items-center justify-between">
      <h4 style="margin:0;">Primjerci</h4>
      <button class="btn btn-sm btn-primary" onclick="quickAddCopyToBook('${book.id}')"><i class="fa-solid fa-plus"></i> Dodaj primjerak</button>
    </div>
    <div class="table-wrap mt-8">
      <table class="data-table">
        <thead><tr><th>Inv. broj</th><th>Polica</th><th>Stanje</th><th>Cijena</th><th>Status</th><th>Trenutni korisnik</th><th>Akcije</th></tr></thead>
        <tbody>
          ${copies.map(c => `<tr>
            <td class="font-bold">${c.inventory_number}</td>
            <td>${escapeHtml(c.shelf_location || '—')}</td>
            <td>${escapeHtml(c.condition || '—')}</td>
            <td>${c.purchase_price != null ? Number(c.purchase_price).toFixed(2) + ' EUR' : '—'}</td>
            <td>${renderStatusBadge(c.status, c.due_date)}</td>
            <td>${c.status === 'borrowed' ? escapeHtml(c.borrower_name || '—') : '—'}</td>
            <td>
              ${c.status !== 'lost' ? `<button class="btn btn-sm btn-neutral" onclick="markCopyStatus('${c.id}','lost')">Izgubljeno</button>` : ''}
              ${c.status !== 'damaged' ? `<button class="btn btn-sm btn-neutral" onclick="markCopyStatus('${c.id}','damaged')">Osteceno</button>` : ''}
              ${(c.status === 'lost' || c.status === 'damaged') ? `<button class="btn btn-sm btn-neutral" onclick="markCopyStatus('${c.id}','available')">Vrati u upotrebu</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions"><button class="btn btn-neutral" onclick="closeBookDetail()">Zatvori</button></div>
  `;
  document.getElementById('book-detail-modal').classList.remove('hidden');
}
function closeBookDetail() { document.getElementById('book-detail-modal').classList.add('hidden'); }

async function markCopyStatus(copyId, status) {
  if (!confirm(`Da li ste sigurni da zelite promijeniti status ovog primjerka na "${status}"?`)) return;
  IDSS.showLoading('Azuriranje...');
  try {
    await IDSS.apiUpdate('book_copies', copyId, { status });
    await IDSS.logAudit(status === 'lost' ? 'copy_marked_lost' : status === 'damaged' ? 'copy_marked_damaged' : 'copy_status_reset', 'book_copy', copyId, { status });
    const idx = ALL_COPIES.findIndex(c => c.id === copyId);
    if (idx >= 0) { ALL_COPIES[idx].status = status; openBookDetail(ALL_COPIES[idx].book_id); applyFilters(); }
    IDSS.toast('Status azuriran.', 'success');
  } catch (e) {
    IDSS.toast('Greska pri azuriranju statusa.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

async function quickAddCopyToBook(bookId) {
  const book = ALL_BOOKS.find(b => b.id === bookId);
  closeBookDetail();
  ADD_BOOK_STATE = { existingBookId: bookId, book, dupChecked: true, isbn: book.isbn };
  document.getElementById('add-book-modal').classList.remove('hidden');
  proceedToDetails(true);
}

/* =====================================================================
   EXCEL EXPORT
   ===================================================================== */

function exportLibraryExcel() {
  IDSS.showLoading('Priprema Excel fajla...');
  try {
    const rows = FILTERED_ROWS.map(r => ({
      'Inventarni broj': r.copy.inventory_number,
      'ISBN': r.book.isbn || '',
      'Naslov': r.book.title || '',
      'Autor': r.book.author || '',
      'Kategorija': r.book.category || '',
      'Jezik': r.book.language || '',
      'Izdavac': r.book.publisher || '',
      'Godina': r.book.publication_year || '',
      'Polica': r.copy.shelf_location || '',
      'Status': r.copy.status || '',
      'Zaduzio': r.copy.borrower_name || '',
      'Datum zaduzenja': r.copy.borrowed_date ? IDSS.fmtDate(r.copy.borrowed_date) : '',
      'Rok povrata': r.copy.due_date ? IDSS.fmtDate(r.copy.due_date) : '',
      'Datum dodavanja': r.copy.added_date ? IDSS.fmtDate(r.copy.added_date) : ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventar');
    const filename = `IDSS_Library_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    IDSS.logAudit('export_generated', 'library', '', { filename, rowCount: rows.length });
    IDSS.toast('Excel fajl je preuzet.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri izvozu.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}
