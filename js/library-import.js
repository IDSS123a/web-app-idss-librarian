/* ============================================================
   IDSS Librarian — Bulk library import (.xlsx or .pdf)
   Pipeline: parse -> dedupe/validate -> preview (Novo/Vec postoji/Greska)
             -> explicit confirm (UVEZI) -> create books + book_copies
             -> result summary.

   Duplicate rule (hard requirement): every row is checked against the
   existing catalog by ISBN before anything is written. A match is never
   silently merged or silently skipped — it is shown in the preview as
   "Vec postoji" with the existing title, and confirming import for that
   row ADDS COPIES to the existing book rather than creating a second book
   record for the same ISBN. Rows without an ISBN cannot be matched this
   way and are flagged for manual review instead of guessed at.
   ============================================================ */

let LIB_IMPORT_STATE = { rows: [], sourceName: '' };

function openLibraryImportModal() {
  LIB_IMPORT_STATE = { rows: [], sourceName: '' };
  document.getElementById('lib-import-file-input').value = '';
  document.getElementById('lib-import-upload-error').classList.add('hidden');
  showLibraryImportStep('upload');
  document.getElementById('lib-import-modal').classList.remove('hidden');
}
function closeLibraryImportModal() {
  document.getElementById('lib-import-modal').classList.add('hidden');
  loadInventory();
}
function backToLibraryImportUpload() { showLibraryImportStep('upload'); }
function showLibraryImportStep(step) {
  ['upload', 'processing', 'preview', 'result'].forEach(s => document.getElementById(`lib-import-step-${s}`).classList.toggle('hidden', s !== step));
}
function showLibImportError(msg) {
  const box = document.getElementById('lib-import-upload-error');
  box.textContent = msg;
  box.classList.remove('hidden');
}

function downloadLibraryImportTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['naslov', 'autor', 'isbn', 'izdavac', 'godina', 'tip', 'predmet', 'razred', 'broj primjeraka', 'cijena'],
    ['Zahlenzauber 2 - Arbeitsheft', 'Ruth Dolenc-Petz', '978-3-637-01873-0', 'Schöningh', 2016, 'Udzbenik', 'Mathe', '2', 2, '10.51']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stavke');
  XLSX.writeFile(wb, 'IDSS_Uvoz_Biblioteke_Predlozak.xlsx');
}

async function processLibraryImportFile() {
  const fileInput = document.getElementById('lib-import-file-input');
  const errBox = document.getElementById('lib-import-upload-error');
  errBox.classList.add('hidden');
  const file = fileInput.files[0];
  if (!file) { showLibImportError('Molimo izaberite .xlsx ili .pdf fajl.'); return; }
  const name = file.name.toLowerCase();
  LIB_IMPORT_STATE.sourceName = file.name;

  showLibraryImportStep('processing');
  document.getElementById('lib-import-processing-msg').textContent = 'Obradjujem uvezeni fajl...';
  try {
    let rawRows;
    if (name.endsWith('.xlsx')) {
      rawRows = await parseXlsxLibraryFile(file);
    } else if (name.endsWith('.pdf')) {
      rawRows = await parsePdfInvoiceFile(file);
    } else {
      showLibraryImportStep('upload');
      showLibImportError('Podrzani formati su .xlsx i .pdf.');
      return;
    }

    if (!rawRows || rawRows.length === 0) {
      showLibraryImportStep('upload');
      showLibImportError('Nije pronadjena nijedna stavka u fajlu.');
      return;
    }

    buildLibraryImportPreview(rawRows);
  } catch (e) {
    console.error(e);
    showLibraryImportStep('upload');
    showLibImportError('Fajl se nije mogao obraditi: ' + (e.message || e));
  }
}

/* ---------------- XLSX parsing ---------------- */

const LIB_HEADER_ALIASES = {
  title: ['naslov', 'naslov udzbenika', 'title'],
  author: ['autor', 'author'],
  isbn: ['isbn', 'sifra', 'sifra (isbn)', 'sifra(isbn)'],
  publisher: ['izdavac', 'publisher'],
  year: ['godina', 'godina izdanja', 'year'],
  category: ['tip', 'kategorija', 'category'],
  subject: ['predmet', 'subject'],
  grade: ['razred', 'grade'],
  qty: ['broj primjeraka na stanju', 'broj primjeraka', 'kolicina', 'komada', 'qty'],
  price: ['cijena', 'jedinicna cijena', 'einzelpreis', 'price']
};

function matchLibHeader(header) {
  const norm = IDSS.normalize(header);
  for (const [field, aliases] of Object.entries(LIB_HEADER_ALIASES)) {
    if (aliases.some(a => IDSS.normalize(a) === norm)) return field;
  }
  return null;
}

// Handles annotated quantity cells seen in real evidencija files, e.g.
// "9 (10)" or "6 (n.i.)" — takes the leading integer, ignores the note.
function parseLooseInt(v) {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function parseLoosePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[^\d.,]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function parseXlsxLibraryFile(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) return [];

  const headerMap = {};
  Object.keys(rows[0]).forEach(h => { const f = matchLibHeader(h); if (f) headerMap[h] = f; });
  if (!Object.values(headerMap).includes('title')) {
    throw new Error('Fajl ne sadrzi kolonu za naslov (naslov / title).');
  }

  return rows.map((r, idx) => {
    const obj = { _rowRef: `red ${idx + 2}` };
    Object.entries(headerMap).forEach(([orig, field]) => { obj[field] = (r[orig] ?? '').toString().trim(); });
    return {
      title: obj.title || '', author: obj.author || '', isbn: cleanIsbn(obj.isbn || ''),
      publisher: obj.publisher || '', year: parseLooseInt(obj.year), category: obj.category || '',
      subject: obj.subject || '', grade: obj.grade || '', qty: parseLooseInt(obj.qty) || 0,
      price: parseLoosePrice(obj.price), sourceRef: obj._rowRef
    };
  }).filter(r => r.title);
}

/* ---------------- PDF parsing (Buchingen-style Rechnung/Lieferschein) ----------------
   Tuned to this supplier's layout: a line starting with a quantity, ending
   in "<n> <einzelpreis> EUR <gesamt> EUR", one or more description
   continuation lines, then a bare ISBN-13 line, then a "Lieferung vom..."
   line to discard. Any block reaching end-of-text or the next quantity
   line without finding an ISBN (e.g. a "Versandkosten" shipping line) is
   surfaced as a warning row rather than silently dropped. */

async function parsePdfInvoiceFile(file) {
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text items into lines by their y position (pdf.js gives item-level text, not lines)
    const byY = new Map();
    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    });
    const pageLines = Array.from(byY.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    lines = lines.concat(pageLines);
  }

  const QTY_LINE = /^(\d+)\s+(.+?)\s+\d\s+([\d.,]+)\s*EUR\s+([\d.,]+)\s*EUR$/;
  const ISBN_LINE = /^(97[89][\d-]{10,15}\d)$/;

  const results = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(QTY_LINE);
    if (!m) { i++; continue; }
    const qty = parseInt(m[1], 10);
    let descParts = [m[2]];
    const unitPrice = parseLoosePrice(m[3]);
    let j = i + 1;
    let isbn = '';
    while (j < lines.length) {
      if (ISBN_LINE.test(lines[j].replace(/\s/g, ''))) { isbn = cleanIsbn(lines[j].replace(/\s/g, '')); j++; break; }
      if (QTY_LINE.test(lines[j]) || /^Lieferung vom/i.test(lines[j])) break; // no ISBN found for this block
      descParts.push(lines[j]);
      j++;
    }
    while (j < lines.length && /^Lieferung vom/i.test(lines[j])) j++;

    const fullDesc = descParts.join(' ').replace(/\s+/g, ' ').trim();
    let author = '', title = fullDesc;
    const colonIdx = fullDesc.indexOf(': ');
    if (colonIdx > 0 && colonIdx < 40) { author = fullDesc.slice(0, colonIdx).trim(); title = fullDesc.slice(colonIdx + 2).trim(); }
    const yearMatch = fullDesc.match(/(19|20)\d{2}/);

    results.push({
      title, author, isbn, publisher: '', year: yearMatch ? parseInt(yearMatch[0], 10) : null,
      category: '', subject: '', grade: '', qty: isbn ? qty : 0, price: unitPrice,
      sourceRef: `"${fullDesc.slice(0, 60)}"`, noIsbnWarning: !isbn
    });
    i = j;
  }
  return results;
}

/* ---------------- Preview + dedupe ---------------- */

function buildLibraryImportPreview(rawRows) {
  // Merge rows sharing the same ISBN within the file (e.g. an invoice split
  // across several partial deliveries) by summing quantity, keeping the
  // first non-empty price/description.
  const merged = new Map(); // isbn -> row ; '' key rows kept individually
  const noIsbnRows = [];
  rawRows.forEach(r => {
    if (!r.isbn) { noIsbnRows.push(r); return; }
    if (merged.has(r.isbn)) {
      const existing = merged.get(r.isbn);
      existing.qty += r.qty || 0;
      existing.sourceRef += `, ${r.sourceRef}`;
    } else {
      merged.set(r.isbn, Object.assign({}, r));
    }
  });
  const allRows = [...merged.values(), ...noIsbnRows];

  const existingByIsbn = new Map(ALL_BOOKS.filter(b => b.isbn).map(b => [cleanIsbn(b.isbn), b]));

  const preview = allRows.map(r => {
    const errors = [];
    if (!r.title) errors.push('Nedostaje naslov');
    if (r.noIsbnWarning) errors.push('Nije pronadjen ISBN u fajlu (moguce da je stavka poput postarine/troska) — provjerite rucno');
    if (!r.isbn && !r.noIsbnWarning) errors.push('Nema ISBN — nije moguce automatski provjeriti da li vec postoji, provjerite rucno');

    let status = 'new', existingBook = null;
    if (errors.length > 0) {
      status = 'error';
    } else if (r.isbn && existingByIsbn.has(r.isbn)) {
      status = 'exists';
      existingBook = existingByIsbn.get(r.isbn);
    }

    const category = matchCategoryName(r.category);

    return Object.assign({}, r, { status, errors, existingBookId: existingBook ? existingBook.id : null, existingTitle: existingBook ? existingBook.title : '', category });
  });

  LIB_IMPORT_STATE.rows = preview;
  renderLibraryImportPreview();
  showLibraryImportStep('preview');
}

// Map a free-text category/tip value onto an existing category name when
// there's a clear match; otherwise keep the original text as-is (categories
// aren't a hard foreign key in this schema) so nothing is silently dropped.
function matchCategoryName(raw) {
  if (!raw) return '';
  const norm = IDSS.normalize(raw);
  const found = ALL_CATEGORIES.find(c => IDSS.normalize(c.name) === norm || IDSS.normalize(c.name).startsWith(norm));
  return found ? found.name : raw;
}

function renderLibraryImportPreview() {
  const rows = LIB_IMPORT_STATE.rows;
  const newCount = rows.filter(r => r.status === 'new').length;
  const existsCount = rows.filter(r => r.status === 'exists').length;
  const errorCount = rows.filter(r => r.status === 'error').length;

  document.getElementById('lib-import-preview-summary').textContent =
    `${newCount} novih naslova, ${existsCount} vec postoji u biblioteci (dodace se samo primjerci), ${errorCount} sa greskom/upozorenjem — izvor: ${LIB_IMPORT_STATE.sourceName}`;

  document.getElementById('lib-import-preview-tbody').innerHTML = rows.map(r => {
    const badge = r.status === 'new' ? '<span class="badge badge-available">Novo</span>' :
      r.status === 'exists' ? '<span class="badge badge-borrowed">Vec postoji</span>' :
      '<span class="badge badge-overdue">Provjeriti</span>';
    const meta = [r.category, r.subject, r.grade].filter(Boolean).join(' / ') || '—';
    const details = r.status === 'exists' ? `Postojeci naslov: "${escapeHtml(r.existingTitle)}"` : r.errors.join('; ') || '—';
    return `<tr>
      <td>${badge}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.author || '—')}</td>
      <td>${escapeHtml(r.isbn || '—')}</td><td>${escapeHtml(meta)}</td>
      <td>${r.qty || 0}</td><td>${r.price != null ? r.price.toFixed(2) + ' EUR' : '—'}</td>
      <td class="text-sm text-muted">${details}</td>
    </tr>`;
  }).join('');
}

async function confirmLibraryImport() {
  const rows = LIB_IMPORT_STATE.rows.filter(r => r.status !== 'error');
  const errorRows = LIB_IMPORT_STATE.rows.filter(r => r.status === 'error');
  if (rows.length === 0) { IDSS.toast('Nema stavki za uvoz (sve zahtijevaju rucnu provjeru).', 'error'); return; }

  document.getElementById('lib-import-confirm-btn').disabled = true;
  IDSS.showLoading('Uvozim stavke...');
  const session = IDSS.getSession();
  let newBooks = 0, addedCopiesBooks = 0, totalCopies = 0;
  try {
    const settings = await getSettingsCached();
    let seq = settings.next_inventory_seq || 1;

    for (const r of rows) {
      let bookId = r.existingBookId;
      if (!bookId) {
        const created = await IDSS.apiCreate('books', {
          id: IDSS.uid('book-'), isbn: r.isbn, title: r.title, author: r.author, publisher: r.publisher,
          publication_year: r.year, language: 'DE', category: r.category || 'Ostalo', subtitle: '',
          page_count: null, description: '', cover_url: '', created_by: session.full_name
        });
        bookId = created.id;
        ALL_BOOKS.push(created);
        await IDSS.logAudit('book_created', 'book', bookId, { title: r.title, isbn: r.isbn, source: 'bulk_import' });
        newBooks++;
      } else {
        addedCopiesBooks++;
      }

      const qty = Math.max(0, r.qty || 0);
      for (let k = 0; k < qty; k++) {
        const invNumber = `${settings.inventory_prefix || 'IDSS-LIB-'}${String(seq).padStart(6, '0')}`;
        seq++;
        const copy = await IDSS.apiCreate('book_copies', {
          id: IDSS.uid('copy-'), book_id: bookId, inventory_number: invNumber,
          subject: r.subject || '', grade: r.grade || '', shelf_location: '', condition: 'novo', status: 'available',
          notes: `Uvezeno iz: ${LIB_IMPORT_STATE.sourceName}`, added_date: new Date().toISOString(), purchase_price: r.price
        });
        ALL_COPIES.push(copy);
        totalCopies++;
        await IDSS.logAudit('copy_added', 'book_copy', copy.id, { inventory_number: invNumber, book_id: bookId, source: 'bulk_import' });
      }
    }
    if (totalCopies > 0) await IDSS.apiUpdate('settings', settings.id, { next_inventory_seq: seq });

    await IDSS.logAudit('books_bulk_imported', 'book', '', {
      file_name: LIB_IMPORT_STATE.sourceName, new_books: newBooks, copies_added_to_existing: addedCopiesBooks,
      total_copies: totalCopies, warned_rows: errorRows.length
    });

    document.getElementById('lib-import-result-text').textContent =
      `${newBooks} novih naslova, ${addedCopiesBooks} naslova dopunjeno novim primjercima, ${totalCopies} primjeraka ukupno dodano.` +
      (errorRows.length > 0 ? ` ${errorRows.length} stavki je preskoceno (potrebna rucna provjera).` : '');
    showLibraryImportStep('result');
    applyFilters();
    IDSS.toast('Uvoz zavrsen.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri uvozu. Neke stavke mozda nisu sacuvane.', 'error');
  } finally {
    document.getElementById('lib-import-confirm-btn').disabled = false;
    IDSS.hideLoading();
  }
}
