// /api/score.js
import { sql } from '@vercel/postgres';

export const config = { runtime: 'nodejs' };

function getIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').toString();
  if (xf) return xf.split(',')[0].trim();
  return (req.headers['x-real-ip'] || req.socket?.remoteAddress || '0.0.0.0').toString();
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // --- body ---
    const { name, score } = req.body || {};
    const n = (name || '').trim();
    const s = Number(score);

    if (!n || n.length < 2 || !Number.isFinite(s) || s < 0 || s > 1e6) {
      return res.status(400).json({ ok: false, error: 'bad_input' });
    }

    // --- tablolar (idempotent) ---
    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        ip TEXT NOT NULL,
        rkey TEXT NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        count INT NOT NULL,
        PRIMARY KEY (ip, rkey, window_start)
      );
    `;

    // --- rate limit: IP başına dakikada 20 istek ---
    const ip = getIp(req);
    const RKEY = 'score_min';
    const LIMIT = 20;

    const { rows: r1 } = await sql`
      INSERT INTO rate_limits (ip, rkey, window_start, count)
      VALUES (${ip}, ${RKEY}, date_trunc('minute', now()), 1)
      ON CONFLICT (ip, rkey, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count;
    `;
    if (r1?.[0]?.count > LIMIT) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    // --- upsert: sadece en yüksek skoru tut ---
    const { rows } = await sql`
      INSERT INTO scores (name, best)
      VALUES (${n}, ${s})
      ON CONFLICT (name)
      DO UPDATE SET best = GREATEST(scores.best, EXCLUDED.best),
                    updated_at = NOW()
      RETURNING best;
    `;

    return res.status(200).json({ ok: true, best: rows[0].best });
  } catch (e) {
    console.error('score error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
