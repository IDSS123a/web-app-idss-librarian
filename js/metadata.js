/* ============================================================
   IDSS Librarian — ISBN metadata lookup
   Fallback chain: Google Books API -> DNB (Deutsche Nationalbibliothek)
   -> BnF (Bibliotheque nationale de France) -> Open Library -> manual.
   All free, no-auth, CORS-enabled public services.

   IDSS shelves are predominantly German (Cornelsen, Klett, Schul Expert),
   French, and English textbooks, plus Bosnian/regional publishers (NAM,
   Svjetlost Komerc, Bosanska knjiga...). Coverage per source:
     - Google Books: broad, but the anonymous (no API key) endpoint shares
       a small global quota that is frequently already exhausted.
     - DNB: authoritative + unlimited for German ISBNs.
     - BnF: authoritative + unlimited for French ISBNs.
     - Open Library: broad general fallback, thin on all of the above.
     - Bosnian/regional publishers: no free public metadata API exists —
       BiH's library union catalog (COBISS) requires an institutional
       agreement, not a public endpoint. Manual entry / cover-photo OCR
       is the honest fallback for those until/unless that changes.
   ============================================================ */

function cleanIsbn(raw) {
  return (raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

async function lookupIsbn(rawIsbn) {
  const isbn = cleanIsbn(rawIsbn);
  if (!isbn) return { found: false, source: null, book: null, isbn: rawIsbn };

  // 1. Google Books
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (res.ok) {
      const data = await res.json();
      if (data.totalItems > 0 && data.items && data.items[0]) {
        const v = data.items[0].volumeInfo || {};
        return {
          found: true,
          source: 'google_books',
          isbn,
          book: {
            title: v.title || '',
            subtitle: v.subtitle || '',
            author: (v.authors || []).join(', '),
            publisher: v.publisher || '',
            publication_year: extractYear(v.publishedDate),
            language: (v.language || '').toUpperCase(),
            page_count: v.pageCount || null,
            description: v.description || '',
            cover_url: (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || ''
          }
        };
      }
    }
  } catch (e) { console.warn('Google Books lookup failed:', e); }

  // 2. DNB (Deutsche Nationalbibliothek) — best coverage for German ISBNs
  try {
    const dnbBook = await lookupDnb(isbn);
    if (dnbBook) return { found: true, source: 'dnb', isbn, book: dnbBook };
  } catch (e) { console.warn('DNB lookup failed:', e); }

  // 3. BnF (Bibliotheque nationale de France) — best coverage for French ISBNs
  try {
    const bnfBook = await lookupBnf(isbn);
    if (bnfBook) return { found: true, source: 'bnf', isbn, book: bnfBook };
  } catch (e) { console.warn('BnF lookup failed:', e); }

  // 4. Open Library fallback
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    if (res.ok) {
      const data = await res.json();
      const key = `ISBN:${isbn}`;
      if (data[key]) {
        const d = data[key];
        return {
          found: true,
          source: 'open_library',
          isbn,
          book: {
            title: d.title || '',
            subtitle: d.subtitle || '',
            author: (d.authors || []).map(a => a.name).join(', '),
            publisher: (d.publishers || []).map(p => p.name).join(', '),
            publication_year: extractYear(d.publish_date),
            language: '',
            page_count: d.number_of_pages || null,
            description: '',
            cover_url: (d.cover && (d.cover.medium || d.cover.large || d.cover.small)) || ''
          }
        };
      }
    }
  } catch (e) { console.warn('Open Library lookup failed:', e); }

  // 5. Not found anywhere -> manual entry
  return { found: false, source: null, isbn, book: null };
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

// ---------- Shared helpers for SRU/Dublin-Core based lookups (DNB, BnF) ----------
const SRU_LANG_MAP = {
  ger: 'DE', deu: 'DE', eng: 'EN', fre: 'FR', fra: 'FR', ita: 'IT',
  spa: 'ES', bos: 'BS', hrv: 'HR', srp: 'SR', tur: 'TR'
};

function sruText(xmlDoc, tagName) {
  const el = xmlDoc.getElementsByTagName(tagName)[0];
  return el ? (el.textContent || '').trim() : '';
}

function sruAllText(xmlDoc, tagName) {
  return Array.from(xmlDoc.getElementsByTagName(tagName)).map(el => (el.textContent || '').trim()).filter(Boolean);
}

// Handles both "Nachname, Vorname [Verfasser]" (DNB) and
// "Nachname, Vorname (1900-1944). Auteur du texte" (BnF) -> "Vorname Nachname"
function formatCreatorName(raw) {
  let cleaned = raw.split('. ')[0]; // drop a trailing ". Role du texte" (BnF)
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*$/, ''); // drop a trailing "[Role]" (DNB)
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, '').trim(); // drop trailing "(dates)"
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : cleaned;
}

// Handles both "Ort : Verlag" (DNB) and "Verlag (Ort)" (BnF)
function extractPublisher(raw) {
  if (raw.includes(':')) return raw.split(':').slice(1).join(':').trim();
  const withoutPlace = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return withoutPlace || raw;
}

function extractPageCount(formatStr) {
  const m = formatStr.match(/(\d+)\s*(?:S\.?|Seiten|p\.?|pages?)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

async function fetchSruDcRecord(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const xmlText = await res.text();
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (xml.getElementsByTagName('parsererror').length) return null;
  const numberOfRecords = parseInt(sruText(xml, 'numberOfRecords') || '0', 10);
  if (!numberOfRecords) return null;
  const title = sruText(xml, 'dc:title');
  if (!title) return null;
  return xml;
}

async function lookupDnb(isbn) {
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D${isbn}&recordSchema=oai_dc&maximumRecords=1`;
  const xml = await fetchSruDcRecord(url);
  if (!xml) return null;

  const publisherRaw = sruText(xml, 'dc:publisher'); // "Ort : Verlag"
  const langRaw = sruText(xml, 'dc:language').toLowerCase();

  return {
    title: sruText(xml, 'dc:title'),
    subtitle: '',
    author: sruAllText(xml, 'dc:creator').map(formatCreatorName).join(', '),
    publisher: extractPublisher(publisherRaw),
    publication_year: extractYear(sruText(xml, 'dc:date')),
    language: SRU_LANG_MAP[langRaw] || (langRaw ? langRaw.toUpperCase() : ''),
    page_count: extractPageCount(sruText(xml, 'dc:format')),
    description: '',
    cover_url: ''
  };
}

async function lookupBnf(isbn) {
  const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.isbn%20all%20%22${isbn}%22&recordSchema=dublincore&maximumRecords=1`;
  const xml = await fetchSruDcRecord(url);
  if (!xml) return null;

  const publisherRaw = sruText(xml, 'dc:publisher'); // "Verlag (Ort)"
  const langRaw = sruText(xml, 'dc:language').toLowerCase();

  return {
    title: sruText(xml, 'dc:title'),
    subtitle: '',
    author: sruAllText(xml, 'dc:creator').map(formatCreatorName).join(', '),
    publisher: extractPublisher(publisherRaw),
    publication_year: extractYear(sruText(xml, 'dc:date')),
    language: SRU_LANG_MAP[langRaw] || (langRaw ? langRaw.toUpperCase() : ''),
    page_count: extractPageCount(sruText(xml, 'dc:format')),
    description: '',
    cover_url: ''
  };
}
