// POST /api/admin/set-password  { staffId, newPassword }
//
// Admin-only: directly set/reset another staff member's login password,
// bypassing the normal self-service "claim your account" / "forgot
// password" email flows entirely. Requires SUPABASE_SERVICE_ROLE_KEY (a
// Vercel env var, never shipped to the frontend) -- this is the one place
// in the app that key is used, and only after independently verifying the
// caller is an active admin via their own JWT (never trusts a client-sent
// role/flag).
const { createClient } = require('@supabase/supabase-js');
const { getClient, getAccessToken } = require('../_supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lhsdqicltpcibemcwtaj.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = getAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    // Verify the caller is a real, active admin -- using their own JWT
    // (RLS-scoped), never a value the client could forge in the body.
    const callerClient = getClient(token);
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData || !userData.user) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    const { data: callerStaff } = await callerClient.from('staff').select('role,active')
      .eq('auth_user_id', userData.user.id).eq('active', true).maybeSingle();
    if (!callerStaff || callerStaff.role !== 'admin') {
      res.status(403).json({ error: 'Samo administrator moze postaviti lozinku drugom nalogu.' });
      return;
    }

    const { staffId, newPassword } = req.body || {};
    if (!staffId || !newPassword || String(newPassword).length < 8) {
      res.status(400).json({ error: 'staffId i newPassword (min. 8 znakova) su obavezni.' });
      return;
    }

    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Server nije podesen: nedostaje SUPABASE_SERVICE_ROLE_KEY (Vercel env var).' });
      return;
    }
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: targetStaff, error: targetErr } = await adminClient.from('staff').select('*').eq('id', staffId).maybeSingle();
    if (targetErr || !targetStaff) {
      res.status(404).json({ error: 'Nalog nije pronadjen.' });
      return;
    }
    if (!targetStaff.email) {
      res.status(400).json({ error: 'Ovaj nalog nema unesen email -- dodajte email prije postavljanja lozinke.' });
      return;
    }

    if (targetStaff.auth_user_id) {
      const { error } = await adminClient.auth.admin.updateUserById(targetStaff.auth_user_id, { password: String(newPassword) });
      if (error) throw error;
    } else {
      const { data: created, error } = await adminClient.auth.admin.createUser({
        email: targetStaff.email, password: String(newPassword), email_confirm: true
      });
      if (error) throw error;
      const { error: linkErr } = await adminClient.from('staff').update({ auth_user_id: created.user.id }).eq('id', staffId);
      if (linkErr) throw linkErr;
    }

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
};
