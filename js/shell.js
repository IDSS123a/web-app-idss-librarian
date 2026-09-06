/* ============================================================
   IDSS Librarian — App Shell (sidebar / topbar / bottom nav)
   Injected into every authenticated page via renderShell(activeKey)
   ============================================================ */

const NAV_ITEMS = [
  { key: 'dashboard', href: 'index.html', label: 'Kontrolna tabla', icon: 'fa-gauge-high', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'scan', href: 'scan.html', label: 'Skeniraj', icon: 'fa-barcode', roles: ['admin', 'librarian'], scan: true },
  { key: 'library', href: 'library.html', label: 'Biblioteka', icon: 'fa-book', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'borrowing', href: 'borrowing.html', label: 'Zaduzenja', icon: 'fa-right-from-bracket', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'returns', href: 'returns.html', label: 'Povrati', icon: 'fa-right-to-bracket', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'students', href: 'students.html', label: 'Ucenici', icon: 'fa-user-graduate', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'statistics', href: 'statistics.html', label: 'Statistika', icon: 'fa-chart-pie', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'reports', href: 'reports.html', label: 'Izvjestaji', icon: 'fa-file-export', roles: ['admin', 'librarian', 'viewer', 'teacher'] },
  { key: 'settings', href: 'settings.html', label: 'Podesavanja', icon: 'fa-gear', roles: ['admin'] },
];

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

async function renderShell(activeKey) {
  const session = await IDSS.requireSession();
  if (!session) return;

  const visibleItems = NAV_ITEMS.filter(i => i.roles.includes(session.role));

  // ---------- Sidebar (desktop) ----------
  const sidebarHtml = `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo-mark"><img src="img/idss-logo.png" alt="IDSS" style="width:100%;height:100%;object-fit:contain;padding:4px;"></div>
        <div class="brand-text">
          <h1>IDSS Librarian</h1>
          <p>Library Management System</p>
        </div>
      </div>
      <ul class="nav-list">
        ${visibleItems.map(i => `
          <li class="nav-item ${i.key === activeKey ? 'active' : ''} ${i.scan ? 'scan-item' : ''}">
            <a href="${i.href}"><i class="fa-solid ${i.icon}"></i> ${i.label}</a>
          </li>`).join('')}
      </ul>
      <div class="sidebar-footer">
        <div class="user-avatar">${initials(session.full_name)}</div>
        <div class="user-meta">
          <div class="u-name">${session.full_name}</div>
          <div class="u-role">${roleLabel(session.role)}</div>
        </div>
        <button class="icon-btn" onclick="IDSS.toggleTheme()" title="Tema"><i class="fa-solid fa-circle-half-stroke"></i></button>
        <button class="icon-btn" onclick="changePasswordPrompt()" title="Promijeni lozinku"><i class="fa-solid fa-key"></i></button>
        <button class="icon-btn" onclick="doLogout()" title="Odjava"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
      </div>
    </aside>`;

  // ---------- Topbar (mobile) ----------
  const topbarHtml = `
    <header class="topbar-mobile">
      <div class="flex items-center gap-8">
        <div class="logo-mark" style="width:88px;height:32px;font-size:13px;"><img src="img/idss-logo.png" alt="IDSS" style="width:100%;height:100%;object-fit:contain;padding:3px;"></div>
        <strong>IDSS Librarian</strong>
      </div>
      <div class="flex items-center gap-8">
        <button class="icon-btn" onclick="IDSS.toggleTheme()"><i class="fa-solid fa-circle-half-stroke"></i></button>
        <button class="icon-btn" onclick="doLogout()"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
      </div>
    </header>`;

  // ---------- Bottom nav (mobile) — priority: Scan, Borrow, Return, Search(Library), Dashboard ----------
  const bottomOrder = ['dashboard', 'library', 'scan', 'borrowing', 'returns'];
  const bottomItems = bottomOrder
    .map(k => visibleItems.find(i => i.key === k))
    .filter(Boolean);

  const bottomHtml = `
    <nav class="bottom-nav">
      ${bottomItems.map(i => {
        if (i.scan) {
          return `<a href="${i.href}" class="scan-fab ${i.key === activeKey ? 'active' : ''}">
            <span class="fab-circle"><i class="fa-solid ${i.icon}"></i></span>
          </a>`;
        }
        return `<a href="${i.href}" class="${i.key === activeKey ? 'active' : ''}">
          <i class="fa-solid ${i.icon}"></i><span>${i.label}</span>
        </a>`;
      }).join('')}
    </nav>`;

  document.getElementById('shell-sidebar-slot').innerHTML = sidebarHtml;
  document.getElementById('shell-topbar-slot').innerHTML = topbarHtml;
  document.getElementById('shell-bottomnav-slot').innerHTML = bottomHtml;

  IDSS.initTheme();
}

function roleLabel(role) {
  return { admin: 'Administrator', librarian: 'Bibliotekar', viewer: 'Pregled', teacher: 'Nastavnik' }[role] || role;
}

async function changePasswordPrompt() {
  const pw1 = prompt('Nova lozinka (najmanje 8 znakova):');
  if (!pw1) return;
  if (pw1.length < 8) { IDSS.toast('Lozinka mora imati najmanje 8 znakova.', 'error'); return; }
  const pw2 = prompt('Ponovite novu lozinku:');
  if (pw1 !== pw2) { IDSS.toast('Lozinke se ne poklapaju.', 'error'); return; }
  IDSS.showLoading('Cuvanje lozinke...');
  try {
    const { error } = await IDSS.getAuthClient().auth.updateUser({ password: pw1 });
    if (error) throw error;
    IDSS.toast('Lozinka je promijenjena.', 'success');
  } catch (e) {
    IDSS.toast('Greska pri promjeni lozinke: ' + (e.message || e), 'error');
  } finally {
    IDSS.hideLoading();
  }
}

async function doLogout() {
  await IDSS.clearSession();
  window.location.href = 'login.html';
}

function guardRole(...roles) {
  const s = IDSS.getSession();
  if (!s || !roles.includes(s.role)) {
    IDSS.toast('Nemate ovlascenja za ovu stranicu.', 'error');
    window.location.href = 'index.html';
    return false;
  }
  return true;
}
