/* ============================================================
   IDSS Librarian — Reusable barcode/QR scanner modal
   Uses html5-qrcode (CDN) for real camera-based scanning.
   Usage: openScanner({ title, subtitle, onResult, onManual }) 
   ============================================================ */

let _html5QrCode = null;
let _scannerActive = false;

function ensureScannerModal() {
  let modal = document.getElementById('scanner-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'scanner-modal';
  modal.className = 'modal-backdrop hidden';
  modal.innerHTML = `
    <div class="modal-box">
      <h3 id="scanner-title">Skeniranje</h3>
      <p class="sub" id="scanner-subtitle">Usmjerite kameru na barkod</p>
      <div class="scanner-wrap">
        <div id="scanner-video-region"></div>
        <div class="scan-frame-overlay"><div class="frame"></div></div>
      </div>
      <div id="scanner-camera-error" class="hidden" style="margin-top:14px;">
        <div class="empty-state">
          <div class="ei"><i class="fa-solid fa-camera-slash"></i></div>
          <h4>Kamera nije dostupna</h4>
          <p>Provjerite dozvole za kameru u pretrazivacu ili unesite kod rucno.</p>
        </div>
      </div>
      <div class="field mt-16">
        <label>Ili unesite kod rucno</label>
        <div class="flex gap-8">
          <input class="input" id="scanner-manual-input" placeholder="npr. 9783125136017">
          <button class="btn btn-primary" onclick="submitManualScan()">Potvrdi</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-neutral" onclick="closeScanner()">Zatvori</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

let _scannerCallback = null;

async function openScanner({ title = 'Skeniranje', subtitle = 'Usmjerite kameru na barkod', onResult, formatsHint = 'auto' } = {}) {
  const modal = ensureScannerModal();
  document.getElementById('scanner-title').textContent = title;
  document.getElementById('scanner-subtitle').textContent = subtitle;
  document.getElementById('scanner-manual-input').value = '';
  document.getElementById('scanner-camera-error').classList.add('hidden');
  document.getElementById('scanner-video-region').classList.remove('hidden');
  modal.classList.remove('hidden');
  _scannerCallback = onResult;

  try {
    if (typeof Html5Qrcode === 'undefined') throw new Error('lib-not-loaded');
    _html5QrCode = new Html5Qrcode('scanner-video-region');
    const config = { fps: 10, qrbox: { width: 260, height: formatsHint === 'qr' ? 260 : 140 } };
    await _html5QrCode.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        handleScanSuccess(decodedText);
      },
      () => { /* per-frame scan failure, ignore — normal while searching */ }
    );
    _scannerActive = true;
  } catch (e) {
    console.warn('Camera unavailable:', e);
    document.getElementById('scanner-video-region').classList.add('hidden');
    document.getElementById('scanner-camera-error').classList.remove('hidden');
    _scannerActive = false;
  }
}

function handleScanSuccess(decodedText) {
  playBeep();
  if (navigator.vibrate) navigator.vibrate(120);
  const cb = _scannerCallback;
  closeScanner();
  if (cb) cb(decodedText.trim());
}

function submitManualScan() {
  const val = document.getElementById('scanner-manual-input').value.trim();
  if (!val) { IDSS.toast('Unesite kod.', 'error'); return; }
  const cb = _scannerCallback;
  closeScanner();
  if (cb) cb(val);
}

async function closeScanner() {
  const modal = document.getElementById('scanner-modal');
  if (modal) modal.classList.add('hidden');
  if (_html5QrCode && _scannerActive) {
    try { await _html5QrCode.stop(); await _html5QrCode.clear(); } catch (e) {}
  }
  _scannerActive = false;
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 130);
  } catch (e) {}
}
