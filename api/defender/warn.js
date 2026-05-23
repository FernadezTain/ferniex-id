import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { userId, username, apiKey } = req.body;
  if (apiKey !== process.env.FID_API_KEY) return res.json({ success: false, error: 'Unauthorized' });

  await supabase.from('defender_warnings')
    .upsert({ user_id: userId, username, warn_count: 0 }, { onConflict: 'user_id', ignoreDuplicates: true });

  const { data } = await supabase.from('defender_warnings')
    .select('warn_count').eq('user_id', userId).single();

  const newCount = (data?.warn_count || 0) + 1;
  const isBlocked = newCount >= 10;

  await supabase.from('defender_warnings').update({
    warn_count: newCount,
    is_blocked: isBlocked,
    blocked_at: isBlocked ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq('user_id', userId);

  return res.json({ success: true, warn_count: newCount, is_blocked: isBlocked });
}