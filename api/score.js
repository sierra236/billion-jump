// /api/score.js
const { sql } = require('@vercel/postgres');

// Bu route Node.js runtime'da çalışmalı (Edge değil)
module.exports.config = { runtime: 'nodejs' };

// Dakikada kaç istek? (IP başına)
const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 30);

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket?.remoteAddress || '').toString();
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const { name, score } = req.body || {};
    const n = (name || '').trim();
    const s = Number(score);

    // minimal doğrulama (saldırıyı engellemek için yeterli)
    if (n.length < 3 || n.length > 20) return res.status(400).json({ ok:false, error:'invalid_name' });
    if (!Number.isFinite(s) || s < 0 || s > 1e9) return res.status(400).json({ ok:false, error:'invalid_score' });

    // tablolar
    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scores_best ON scores(best DESC);`;

    // basit Postgres rate-limit tablosu (IP + dakika kovası)
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        ip TEXT NOT NULL,
        bucket TIMESTAMPTZ NOT NULL,
        count INT NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, bucket)
      );
    `;

    const ip = clientIp(req);
    // dakika kovası
    const { rows: rl } = await sql`
      INSERT INTO rate_limits (ip, bucket, count)
      VALUES (${ip}, date_trunc('minute', NOW()), 1)
      ON CONFLICT (ip, bucket)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count, (EXTRACT(EPOCH FROM ((bucket + interval '1 minute') - NOW())))::int AS retry_in;
    `;
    if (rl[0].count > RATE) {
      return res.status(429).json({ ok:false, error:'rate_limited', retryIn: Math.max(0, rl[0].retry_in) });
    }

    // best upsert
    const { rows } = await sql`
      INSERT INTO scores (name, best)
      VALUES (${n}, ${s})
      ON CONFLICT (name)
      DO UPDATE SET best = GREATEST(scores.best, EXCLUDED.best), updated_at = NOW()
      RETURNING best;
    `;

    return res.status(200).json({ ok:true, best: rows[0].best });
  } catch (e) {
    console.error('score error:', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};
