// GET    /api/tables/:table/:id -> record
// PATCH  /api/tables/:table/:id -> updated record
// DELETE /api/tables/:table/:id -> 204
const { getClient, getAccessToken, KNOWN_TABLES, nullifyEmptyStrings } = require('../../_supabase');

module.exports = async (req, res) => {
  const { table, id } = req.query;

  if (!KNOWN_TABLES.includes(table)) {
    res.status(404).json({ error: `Unknown table: ${table}` });
    return;
  }

  const supabase = getClient(getAccessToken(req));

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) { res.status(404).json({ error: 'Not found' }); return; }
      res.status(200).json(data);
      return;
    }

    if (req.method === 'PATCH') {
      const body = nullifyEmptyStrings(req.body || {});
      delete body.id; // never let the client repoint the primary key
      const { data, error } = await supabase.from(table).update(body).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) { res.status(404).json({ error: 'Not found' }); return; }
      res.status(200).json(data);
      return;
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      res.status(204).end();
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
