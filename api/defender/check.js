import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  const { userId } = req.query;
  if (!userId) return res.json({ success: false });

  const { data } = await supabase.from('defender_warnings')
    .select('warn_count, is_blocked').eq('user_id', userId).single();

  return res.json({
    success: true,
    warn_count: data?.warn_count || 0,
    is_blocked: data?.is_blocked || false
  });
}