// GET  /api/tables/:table?page=&limit=&search=&sort=   -> { data: [...], total: n }
// POST /api/tables/:table   (body = record)             -> created record
//
// This implements the exact Table API contract the static frontend already
// calls via relative `tables/...` fetches (see js/core.js) — vercel.json
// rewrites `tables/*` to `/api/tables/*` so no frontend file needed to change.
const { getClient, SEARCHABLE_COLUMNS, KNOWN_TABLES } = require('../_supabase');

module.exports = async (req, res) => {
  const { table } = req.query;

  if (!KNOWN_TABLES.includes(table)) {
    res.status(404).json({ error: `Unknown table: ${table}` });
    return;
  }

  const supabase = getClient();

  try {
    if (req.method === 'GET') {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
      const search = (req.query.search || '').trim();
      const sort = (req.query.sort || '').trim();

      let query = supabase.from(table).select('*', { count: 'exact' });

      if (search) {
        const cols = SEARCHABLE_COLUMNS[table] || [];
        if (cols.length) {
          const orExpr = cols.map(c => `${c}.ilike.%${search.replace(/[%,]/g, '')}%`).join(',');
          query = query.or(orExpr);
        }
      }

      if (sort) {
        const desc = sort.startsWith('-');
        const col = desc ? sort.slice(1) : sort;
        query = query.order(col, { ascending: !desc });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      res.status(200).json({ data: data || [], total: count || 0, page, limit });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { data, error } = await supabase.from(table).insert(body).select().single();
      if (error) throw error;
      res.status(201).json(data);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
