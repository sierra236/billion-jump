// /api/score.js
import { sql } from '@vercel/postgres';

const MAX_PER_MIN = 3; // IP başına dakikada 30 istek

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export default async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // --------- RATE LIMIT (DB tabanlı, dakika kovası) ---------
    await sql`
      CREATE TABLE IF NOT EXISTS score_hits (
        ip TEXT NOT NULL,
        bucket TIMESTAMPTZ NOT NULL,
        cnt INT NOT NULL,
        PRIMARY KEY (ip, bucket)
      );
    `;
    const ip = getClientIp(req);
    const { rows: lim } = await sql`
      INSERT INTO score_hits (ip, bucket, cnt)
      VALUES (${ip}, date_trunc('minute', NOW()), 1)
      ON CONFLICT (ip, bucket)
      DO UPDATE SET cnt = score_hits.cnt + 1
      RETURNING cnt, bucket;
    `;
    if (lim?.[0]?.cnt > MAX_PER_MIN) {
      res.setHeader('Retry-After', '60'); // basit yönlendirme
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    // ----------------------------------------------------------

    // skor yaz
    const { name, score } = req.body || {};
    const n = String(name || '').trim();
    let s = Number(score);

    if (n.length < 2 || n.length > 20) {
      return res.status(400).json({ ok: false, error: 'invalid_name' });
    }
    if (!Number.isFinite(s)) s = 0;
    s = Math.max(0, Math.floor(s));
    if (s > 1e9) s = 1e9;

    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(name)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scores_best ON scores(best DESC);`;

    const { rows } = await sql`
      INSERT INTO scores (name, best)
      VALUES (${n}, ${s})
      ON CONFLICT (name)
      DO UPDATE SET best = GREATEST(scores.best, EXCLUDED.best), updated_at = NOW()
      RETURNING best;
    `;

    return res.status(200).json({ ok: true, best: rows[0].best });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
