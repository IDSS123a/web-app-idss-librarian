/* ============================================================
   IDSS Librarian — ISBN metadata lookup
   Fallback chain: Google Books API -> DNB (Deutsche Nationalbibliothek)
   -> Open Library API -> manual.
   All free, no-auth, CORS-enabled public services.

   DNB was added after a real miss: the anonymous (no API key) Google
   Books endpoint shares a small global quota that is often already
   exhausted, and Open Library's German-language coverage is thin. As
   a German-curriculum school, most scanned ISBNs are German titles —
   DNB is the authoritative, unlimited, free source for exactly those.
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

  // 3. Open Library fallback
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

  // 4. Not found anywhere -> manual entry
  return { found: false, source: null, isbn, book: null };
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

// ---------- DNB (Deutsche Nationalbibliothek) SRU lookup ----------
const DNB_LANG_MAP = {
  ger: 'DE', deu: 'DE', eng: 'EN', fre: 'FR', fra: 'FR', ita: 'IT',
  spa: 'ES', bos: 'BS', hrv: 'HR', srp: 'SR', tur: 'TR'
};

function dnbText(xmlDoc, tagName) {
  const el = xmlDoc.getElementsByTagName(tagName)[0];
  return el ? (el.textContent || '').trim() : '';
}

function dnbAllText(xmlDoc, tagName) {
  return Array.from(xmlDoc.getElementsByTagName(tagName)).map(el => (el.textContent || '').trim()).filter(Boolean);
}

// "Nachname, Vorname [Verfasser]" -> "Vorname Nachname"
function dnbFormatName(raw) {
  const cleaned = raw.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : cleaned;
}

async function lookupDnb(isbn) {
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D${isbn}&recordSchema=oai_dc&maximumRecords=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const xmlText = await res.text();
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (xml.getElementsByTagName('parsererror').length) return null;
  const numberOfRecords = parseInt(dnbText(xml, 'numberOfRecords') || '0', 10);
  if (!numberOfRecords) return null;

  const title = dnbText(xml, 'dc:title');
  if (!title) return null;

  const authors = dnbAllText(xml, 'dc:creator').map(dnbFormatName);
  const publisherRaw = dnbText(xml, 'dc:publisher'); // "Ort : Verlag"
  const publisher = publisherRaw.includes(':') ? publisherRaw.split(':').slice(1).join(':').trim() : publisherRaw;
  const langRaw = dnbText(xml, 'dc:language').toLowerCase();
  const formatRaw = dnbText(xml, 'dc:format'); // e.g. "62 Seiten"
  const pageMatch = formatRaw.match(/(\d+)\s*S(eiten)?\b/i);

  return {
    title,
    subtitle: '',
    author: authors.join(', '),
    publisher,
    publication_year: extractYear(dnbText(xml, 'dc:date')),
    language: DNB_LANG_MAP[langRaw] || (langRaw ? langRaw.toUpperCase() : ''),
    page_count: pageMatch ? parseInt(pageMatch[1], 10) : null,
    description: '',
    cover_url: ''
  };
}
