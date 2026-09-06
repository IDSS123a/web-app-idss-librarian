/* ============================================================
   IDSS Librarian — Statistics page (all figures computed live)
   ============================================================ */

(async function () {
  await renderShell('statistics');
  IDSS.showLoading('Racunam statistiku...');
  try {
    const [copies, books, borrowings, students] = await Promise.all([
      IDSS.apiListAll('book_copies'), IDSS.apiListAll('books'), IDSS.apiListAll('borrowings'), IDSS.apiListAll('library_users')
    ]);
    renderInventoryStats(copies, books);
    renderCirculationChart(borrowings);
    renderInvStatusChart(copies);
    renderByGradeChart(borrowings);
    renderByMonthChart(borrowings);
    renderTopBooks(borrowings, books);
    renderTopUsers(borrowings);
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri racunanju statistike.', 'error');
  } finally {
    IDSS.hideLoading();
  }
})();

function renderInventoryStats(copies, books) {
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
  const byCategory = {};
  copies.forEach(c => { const b = bookMap[c.book_id]; const cat = b ? (b.category || 'Ostalo') : 'Ostalo'; byCategory[cat] = (byCategory[cat] || 0) + 1; });
  const cards = [
    { label: 'Ukupno stavki', value: copies.length, color: 'linear-gradient(135deg,#035EA1,#08ABE6)', icon: 'fa-layer-group' },
    { label: 'Knjige', value: byCategory['Knjiga'] || 0, color: 'linear-gradient(135deg,#035EA1,#08ABE6)', icon: 'fa-book' },
    { label: 'Udzbenici', value: byCategory['Udzbenik'] || 0, color: 'linear-gradient(135deg,#FFCB29,#ffb703)', icon: 'fa-book-open' },
    { label: 'Lektira', value: byCategory['Lektira'] || 0, color: 'linear-gradient(135deg,#E8262C,#c81f24)', icon: 'fa-feather' },
    { label: 'Radne sveske', value: byCategory['Radna sveska'] || 0, color: 'linear-gradient(135deg,#5b6b7a,#8494a3)', icon: 'fa-pen-ruler' },
    { label: 'Biljeznice', value: byCategory['Biljeznica'] || 0, color: 'linear-gradient(135deg,#5b6b7a,#8494a3)', icon: 'fa-note-sticky' },
    { label: 'Naslova ukupno', value: books.length, color: 'linear-gradient(135deg,#17803d,#22c55e)', icon: 'fa-book-bookmark' },
    { label: 'Ostalo', value: byCategory['Ostalo'] || 0, color: 'linear-gradient(135deg,#8494a3,#5b6b7a)', icon: 'fa-shapes' },
  ];
  document.getElementById('stat-inventory').innerHTML = cards.map(c => `
    <div class="stat-card"><div class="stat-icon" style="background:${c.color};"><i class="fa-solid ${c.icon}"></i></div>
      <div><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div></div>`).join('');
}

function renderCirculationChart(borrowings) {
  const total = borrowings.length;
  const current = borrowings.filter(t => t.status === 'borrowed' && !IDSS.isOverdue(t.due_date)).length;
  const overdue = borrowings.filter(t => t.status === 'borrowed' && IDSS.isOverdue(t.due_date)).length;
  const returned = borrowings.filter(t => t.status === 'returned').length;
  const lost = borrowings.filter(t => t.status === 'lost').length;
  const damaged = borrowings.filter(t => t.status === 'damaged').length;
  if (total === 0) { chartEmpty('chart-circulation', 'Nema podataka o kruzenju jos.'); return; }
  new Chart(document.getElementById('chart-circulation'), {
    type: 'bar',
    data: { labels: ['Trenutno', 'Kasni', 'Vraceno', 'Izgubljeno', 'Osteceno'], datasets: [{ data: [current, overdue, returned, lost, damaged], backgroundColor: ['#08ABE6', '#E8262C', '#17803d', '#5b6b7a', '#f97316'], borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function renderInvStatusChart(copies) {
  if (copies.length === 0) { chartEmpty('chart-inv-status', 'Nema primjeraka u inventaru.'); return; }
  const counts = { available: 0, borrowed: 0, lost: 0, damaged: 0 };
  copies.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
  new Chart(document.getElementById('chart-inv-status'), {
    type: 'pie',
    data: { labels: ['Dostupno', 'Zaduzeno', 'Izgubljeno', 'Osteceno'], datasets: [{ data: [counts.available, counts.borrowed, counts.lost, counts.damaged], backgroundColor: ['#17803d', '#92600a', '#5b6b7a', '#f97316'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderByGradeChart(borrowings) {
  if (borrowings.length === 0) { chartEmpty('chart-by-grade', 'Nema podataka o zaduzenjima.'); return; }
  const byGrade = {};
  borrowings.forEach(t => { const g = t.student_class || 'Nepoznato'; byGrade[g] = (byGrade[g] || 0) + 1; });
  const entries = Object.entries(byGrade).sort((a, b) => b[1] - a[1]).slice(0, 12);
  new Chart(document.getElementById('chart-by-grade'), {
    type: 'bar',
    data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: '#035EA1', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function renderByMonthChart(borrowings) {
  if (borrowings.length === 0) { chartEmpty('chart-by-month', 'Nema podataka o zaduzenjima.'); return; }
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const counts = months.map(m => borrowings.filter(t => (t.borrowed_at || '').slice(0, 7) === m).length);
  new Chart(document.getElementById('chart-by-month'), {
    type: 'line',
    data: { labels: months, datasets: [{ data: counts, borderColor: '#08ABE6', backgroundColor: 'rgba(8,171,230,0.15)', fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function chartEmpty(canvasId, msg) {
  document.getElementById(canvasId).parentElement.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
}

function renderTopBooks(borrowings, books) {
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
  const counts = {};
  borrowings.forEach(t => { counts[t.book_id] = (counts[t.book_id] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const el = document.getElementById('top-books');
  if (sorted.length === 0) { el.innerHTML = '<p class="text-muted text-sm">Nema podataka.</p>'; return; }
  el.innerHTML = sorted.map(([id, count], i) => `<div class="flex justify-between" style="padding:8px 0;border-bottom:1px solid var(--border-soft);">
    <span class="text-sm">${i + 1}. ${bookMap[id] ? bookMap[id].title : 'Nepoznato'}</span><span class="badge badge-borrowed">${count}x</span></div>`).join('');
}

function renderTopUsers(borrowings) {
  const counts = {};
  borrowings.forEach(t => { counts[t.student_name] = (counts[t.student_name] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const el = document.getElementById('top-users');
  if (sorted.length === 0) { el.innerHTML = '<p class="text-muted text-sm">Nema podataka.</p>'; return; }
  el.innerHTML = sorted.map(([name, count], i) => `<div class="flex justify-between" style="padding:8px 0;border-bottom:1px solid var(--border-soft);">
    <span class="text-sm">${i + 1}. ${name}</span><span class="badge badge-borrowed">${count}x</span></div>`).join('');
}
