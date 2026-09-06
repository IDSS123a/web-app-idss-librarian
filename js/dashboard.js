/* ============================================================
   IDSS Librarian — Dashboard logic
   All numbers computed live from Table API data. No mock stats.
   ============================================================ */

(async function () {
  await renderShell('dashboard');
  const session = IDSS.getSession();
  document.getElementById('greeting').textContent = greetingFor(session.full_name);

  IDSS.showLoading('Ucitavanje podataka...');
  try {
    const [copies, books, borrowings, categories] = await Promise.all([
      IDSS.apiListAll('book_copies'),
      IDSS.apiListAll('books'),
      IDSS.apiListAll('borrowings'),
      IDSS.apiListAll('categories')
    ]);

    renderStatCards(copies, books, borrowings);
    renderCategoryChart(copies, books, categories);
    renderActivityChart(borrowings);
    renderTopBooks(borrowings, books);
    renderOverdue(borrowings);
  } catch (e) {
    console.error(e);
    IDSS.toast('Greska pri ucitavanju kontrolne table.', 'error');
  } finally {
    IDSS.hideLoading();
  }
})();

function greetingFor(name) {
  const h = new Date().getHours();
  const first = (name || '').split(' ')[0] || '';
  if (h < 11) return `Dobro jutro, ${first}!`;
  if (h < 18) return `Dobar dan, ${first}!`;
  return `Dobro vece, ${first}!`;
}

function renderStatCards(copies, books, borrowings) {
  const totalItems = copies.length;
  const byCategory = {};
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
  copies.forEach(c => {
    const b = bookMap[c.book_id];
    const cat = b ? (b.category || 'Ostalo') : 'Ostalo';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });
  const borrowedCount = copies.filter(c => c.status === 'borrowed').length;
  const availableCount = copies.filter(c => c.status === 'available').length;
  const overdueCount = borrowings.filter(t => t.status === 'borrowed' && IDSS.isOverdue(t.due_date, t.returned_at)).length;

  const cards = [
    { label: 'Ukupno stavki', value: totalItems, icon: 'fa-layer-group', color: 'linear-gradient(135deg,#035EA1,#08ABE6)' },
    { label: 'Knjige', value: byCategory['Knjiga'] || 0, icon: 'fa-book', color: 'linear-gradient(135deg,#035EA1,#08ABE6)' },
    { label: 'Udzbenici', value: byCategory['Udzbenik'] || 0, icon: 'fa-book-open', color: 'linear-gradient(135deg,#FFCB29,#ffb703)' },
    { label: 'Lektira', value: byCategory['Lektira'] || 0, icon: 'fa-feather', color: 'linear-gradient(135deg,#E8262C,#c81f24)' },
    { label: 'Trenutno zaduzeno', value: borrowedCount, icon: 'fa-right-from-bracket', color: 'linear-gradient(135deg,#92600a,#c98a12)' },
    { label: 'U kasnjenju', value: overdueCount, icon: 'fa-triangle-exclamation', color: 'linear-gradient(135deg,#E8262C,#c81f24)' },
    { label: 'Dostupno', value: availableCount, icon: 'fa-circle-check', color: 'linear-gradient(135deg,#17803d,#22c55e)' },
    { label: 'Sveske/biljeznice', value: byCategory['Biljeznica'] || 0, icon: 'fa-note-sticky', color: 'linear-gradient(135deg,#5b6b7a,#8494a3)' },
  ];

  document.getElementById('stats-grid').innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-icon" style="background:${c.color};"><i class="fa-solid ${c.icon}"></i></div>
      <div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>
    </div>
  `).join('');
}

let categoryChartInstance, activityChartInstance;

function renderCategoryChart(copies, books, categories) {
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
  const byCategory = {};
  copies.forEach(c => {
    const b = bookMap[c.book_id];
    const cat = b ? (b.category || 'Ostalo') : 'Ostalo';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });
  const labels = Object.keys(byCategory);
  const data = Object.values(byCategory);

  if (labels.length === 0) {
    document.getElementById('chart-category').parentElement.innerHTML = emptyChartHtml('Nema podataka o inventaru jos.');
    return;
  }

  const ctx = document.getElementById('chart-category');
  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#035EA1', '#08ABE6', '#FFCB29', '#E8262C', '#17803d', '#8494a3', '#a855f7', '#f97316', '#0ea5e9'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
  });
}

function renderActivityChart(borrowings) {
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const counts = days.map(day => borrowings.filter(t => (t.borrowed_at || '').slice(0, 10) === day).length);

  const ctx = document.getElementById('chart-activity');
  activityChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(d => d.slice(5)),
      datasets: [{
        label: 'Zaduzenja',
        data: counts,
        backgroundColor: '#08ABE6',
        borderRadius: 6,
        maxBarThickness: 26
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderTopBooks(borrowings, books) {
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
  const counts = {};
  borrowings.forEach(t => { counts[t.book_id] = (counts[t.book_id] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const el = document.getElementById('top-books-list');
  if (sorted.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="ei"><i class="fa-solid fa-book"></i></div><h4>Jos nema zaduzenja</h4><p>Najtrazenije knjige ce se prikazati ovdje.</p></div>`;
    return;
  }
  el.innerHTML = sorted.map(([bookId, count], idx) => {
    const b = bookMap[bookId];
    return `<div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border-soft);">
      <div class="flex items-center gap-12">
        <span class="text-muted font-bold" style="width:22px;">${idx + 1}.</span>
        <div>
          <div class="font-bold" style="font-size:13.5px;">${b ? b.title : 'Nepoznata knjiga'}</div>
          <div class="text-muted text-sm">${b ? b.author || '' : ''}</div>
        </div>
      </div>
      <span class="badge badge-borrowed">${count}x</span>
    </div>`;
  }).join('');
}

function renderOverdue(borrowings) {
  const overdue = borrowings.filter(t => t.status === 'borrowed' && IDSS.isOverdue(t.due_date, t.returned_at));
  const el = document.getElementById('overdue-list');
  if (overdue.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="ei"><i class="fa-solid fa-champagne-glasses"></i></div><h4>Odlicno! Nema kasnjenja.</h4><p>Sve knjige su vracene na vrijeme.</p></div>`;
    return;
  }
  el.innerHTML = overdue.slice(0, 8).map(t => {
    const days = IDSS.daysBetween(t.due_date, new Date().toISOString());
    return `<div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border-soft);">
      <div>
        <div class="font-bold" style="font-size:13.5px;">${t.book_title}</div>
        <div class="text-muted text-sm">${t.student_name} · ${t.student_class || ''}</div>
      </div>
      <span class="badge badge-overdue">${days} dana</span>
    </div>`;
  }).join('');
}

function emptyChartHtml(msg) {
  return `<h3 style="margin-top:0;">Stavke po kategoriji</h3><div class="empty-state"><p>${msg}</p></div>`;
}
