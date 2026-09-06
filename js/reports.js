/* ============================================================
   IDSS Librarian — Reports / Excel export hub
   ============================================================ */

renderShell('reports');

const REPORTS = [
  { key: 'physical_layout', label: 'Fizicki raspored', icon: 'fa-list-ol', desc: 'Redoslijed za slaganje na police: kategorija -> predmet -> razred -> naslov' },
  { key: 'full_inventory', label: 'Kompletan inventar', icon: 'fa-book', desc: 'Sve stavke u biblioteci' },
  { key: 'currently_borrowed', label: 'Trenutno zaduzeno', icon: 'fa-right-from-bracket', desc: 'Sve aktivne pozajmice' },
  { key: 'overdue', label: 'Kasnjenja', icon: 'fa-triangle-exclamation', desc: 'Knjige koje kasne sa povratom' },
  { key: 'history', label: 'Istorija zaduzenja', icon: 'fa-clock-rotate-left', desc: 'Kompletna transakcijska istorija' },
  { key: 'by_category', label: 'Po kategoriji', icon: 'fa-shapes', desc: 'Inventar grupisan po kategoriji' },
  { key: 'by_language', label: 'Po jeziku', icon: 'fa-language', desc: 'Inventar grupisan po jeziku' },
  { key: 'students', label: 'Ucenici', icon: 'fa-user-graduate', desc: 'Kompletan spisak ucenika' },
  { key: 'student_history', label: 'Istorija po uceniku', icon: 'fa-id-card', desc: 'Zaduzenja grupisana po uceniku' },
  { key: 'lost_damaged', label: 'Izgubljeno / osteceno', icon: 'fa-triangle-exclamation', desc: 'Stavke oznacene kao izgubljene ili ostecene' },
];

document.getElementById('reports-grid').innerHTML = REPORTS.map(r => `
  <button class="btn-action" onclick="runReport('${r.key}')">
    <div class="aicon" style="background: linear-gradient(135deg, var(--idss-blue), var(--idss-blue-light));"><i class="fa-solid ${r.icon}"></i></div>
    <span class="label">${r.label}</span>
    <small>${r.desc}</small>
  </button>`).join('');

async function runReport(key) {
  IDSS.showLoading('Priprema izvjestaja...');
  try {
    const [copies, books, borrowings, students, categories] = await Promise.all([
      IDSS.apiListAll('book_copies'), IDSS.apiListAll('books'), IDSS.apiListAll('borrowings'), IDSS.apiListAll('library_users'), IDSS.apiListAll('categories')
    ]);
    const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
    let rows = [], sheetName = 'Izvjestaj', filename = 'IDSS_Report';

    switch (key) {
      case 'physical_layout': {
        // Same order as the Biblioteka page's default sort (see
        // comparePhysicalOrder in js/library.js): kategorija (sort_order,
        // Direktorov izbor) -> predmet -> razred -> naslov. Kept in sync
        // manually since this page doesn't load library.js.
        const catOrder = Object.fromEntries(categories.map(c => [c.name, typeof c.sort_order === 'number' ? c.sort_order : 99]));
        const gradeKey = (g) => {
          if (!g) return [1, Number.MAX_SAFE_INTEGER];
          const m = String(g).match(/^(\d+)/);
          return m ? [0, parseInt(m[1], 10)] : [0, Number.MAX_SAFE_INTEGER - 1];
        };
        const sorted = copies.slice().sort((ca, cb) => {
          const ba = bookMap[ca.book_id] || {}, bb = bookMap[cb.book_id] || {};
          const catDiff = (catOrder[ba.category] ?? 99) - (catOrder[bb.category] ?? 99);
          if (catDiff) return catDiff;
          const subjDiff = (ca.subject || '').localeCompare(cb.subject || '');
          if (subjDiff) return subjDiff;
          const ga = gradeKey(ca.grade), gb = gradeKey(cb.grade);
          if (ga[0] !== gb[0]) return ga[0] - gb[0];
          if (ga[1] !== gb[1]) return ga[1] - gb[1];
          return (ba.title || '').localeCompare(bb.title || '');
        });
        rows = sorted.map((c, i) => {
          const b = bookMap[c.book_id] || {};
          return {
            'Red. br.': i + 1, 'Kategorija': b.category || '', 'Predmet': c.subject || '', 'Razred': c.grade || '',
            'Naslov': b.title || '', 'Autor': b.author || '', 'Inventarni broj': c.inventory_number,
            'Trenutna polica (upisana)': c.shelf_location || '', 'Status': c.status
          };
        });
        sheetName = 'Fizicki_raspored'; filename = 'IDSS_Library_Physical_Layout'; break;
      }
      case 'full_inventory':
        rows = copies.map(c => invRow(c, bookMap[c.book_id]));
        sheetName = 'Inventar'; filename = 'IDSS_Library_Full_Inventory'; break;
      case 'currently_borrowed':
        rows = copies.filter(c => c.status === 'borrowed').map(c => invRow(c, bookMap[c.book_id]));
        sheetName = 'Zaduzeno'; filename = 'IDSS_Library_Currently_Borrowed'; break;
      case 'overdue':
        rows = borrowings.filter(t => t.status === 'borrowed' && IDSS.isOverdue(t.due_date)).map(t => ({
          'Knjiga': t.book_title, 'Inv. broj': t.inventory_number, 'Ucenik': t.student_name, 'Razred': t.student_class,
          'Rok povrata': IDSS.fmtDate(t.due_date), 'Kasni (dana)': IDSS.daysBetween(t.due_date, new Date().toISOString())
        }));
        sheetName = 'Kasnjenja'; filename = 'IDSS_Library_Overdue'; break;
      case 'history':
        rows = borrowings.map(t => ({
          'Knjiga': t.book_title, 'Inv. broj': t.inventory_number, 'Ucenik': t.student_name, 'Razred': t.student_class,
          'Zaduzeno': IDSS.fmtDate(t.borrowed_at), 'Rok': IDSS.fmtDate(t.due_date), 'Vraceno': t.returned_at ? IDSS.fmtDate(t.returned_at) : '',
          'Status': t.status, 'Bibliotekar (zaduzenje)': t.librarian_borrowed, 'Bibliotekar (povrat)': t.librarian_returned || ''
        }));
        sheetName = 'Istorija'; filename = 'IDSS_Library_History'; break;
      case 'by_category': {
        const grouped = {};
        copies.forEach(c => { const cat = (bookMap[c.book_id] && bookMap[c.book_id].category) || 'Ostalo'; (grouped[cat] = grouped[cat] || []).push(invRow(c, bookMap[c.book_id])); });
        exportMultiSheet(grouped, 'IDSS_Library_By_Category'); IDSS.hideLoading(); return;
      }
      case 'by_language': {
        const grouped = {};
        copies.forEach(c => { const lang = (bookMap[c.book_id] && bookMap[c.book_id].language) || 'Nepoznato'; (grouped[lang] = grouped[lang] || []).push(invRow(c, bookMap[c.book_id])); });
        exportMultiSheet(grouped, 'IDSS_Library_By_Language'); IDSS.hideLoading(); return;
      }
      case 'students':
        rows = students.map(s => ({ 'ID ucenika': s.student_id, 'Ime': s.first_name, 'Prezime': s.last_name, 'Razred': s.class_name, 'Email': s.email || '', 'Status': s.active === false ? 'Neaktivan' : 'Aktivan' }));
        sheetName = 'Ucenici'; filename = 'IDSS_Library_Students'; break;
      case 'student_history': {
        const grouped = {};
        borrowings.forEach(t => { const key = t.student_name || 'Nepoznato'; (grouped[key] = grouped[key] || []).push({
          'Knjiga': t.book_title, 'Zaduzeno': IDSS.fmtDate(t.borrowed_at), 'Rok': IDSS.fmtDate(t.due_date),
          'Vraceno': t.returned_at ? IDSS.fmtDate(t.returned_at) : '', 'Status': t.status
        }); });
        exportMultiSheet(grouped, 'IDSS_Library_Student_History'); IDSS.hideLoading(); return;
      }
      case 'lost_damaged':
        rows = copies.filter(c => c.status === 'lost' || c.status === 'damaged').map(c => invRow(c, bookMap[c.book_id]));
        sheetName = 'Izgubljeno_Osteceno'; filename = 'IDSS_Library_Lost_Damaged'; break;
    }

    if (rows.length === 0) { IDSS.toast('Nema podataka za ovaj izvjestaj.', 'info'); IDSS.hideLoading(); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await IDSS.logAudit('export_generated', 'report', key, { rowCount: rows.length });
    IDSS.toast('Excel fajl je preuzet.', 'success');
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri generisanju izvjestaja.', 'error');
  } finally {
    IDSS.hideLoading();
  }
}

function invRow(c, b) {
  b = b || {};
  return {
    'Inventarni broj': c.inventory_number, 'ISBN': b.isbn || '', 'Naslov': b.title || '', 'Autor': b.author || '',
    'Kategorija': b.category || '', 'Jezik': b.language || '', 'Izdavac': b.publisher || '', 'Godina': b.publication_year || '',
    'Polica': c.shelf_location || '', 'Status': c.status, 'Zaduzio': c.borrower_name || '',
    'Datum zaduzenja': c.borrowed_date ? IDSS.fmtDate(c.borrowed_date) : '', 'Rok povrata': c.due_date ? IDSS.fmtDate(c.due_date) : ''
  };
}

function exportMultiSheet(grouped, filenameBase) {
  const wb = XLSX.utils.book_new();
  Object.entries(grouped).forEach(([name, rows]) => {
    const safeName = name.toString().slice(0, 30).replace(/[\\/?*[\]]/g, '');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName || 'Sheet');
  });
  XLSX.writeFile(wb, `${filenameBase}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  IDSS.logAudit('export_generated', 'report', filenameBase, {});
  IDSS.toast('Excel fajl je preuzet.', 'success');
}
