/* ============================================================
   IDSS Librarian — ISBN metadata lookup
   Fallback chain: Google Books API -> Open Library API -> manual
   Both are free, no-auth, CORS-enabled public REST APIs.
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

  // 2. Open Library fallback
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

  // 3. Not found anywhere -> manual entry
  return { found: false, source: null, isbn, book: null };
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}
