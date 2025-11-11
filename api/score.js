const { sql } = require('@vercel/postgres');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    const { name, score } = req.body || {};
    const n = (name || '').trim();
    const s = Number(score);

    if (n.length < 3 || n.length > 20) {
      return res.status(400).json({ ok: false, error: 'invalid_name' });
    }
    if (!Number.isFinite(s) || s < 0 || s > 1e9) {
      return res.status(400).json({ ok: false, error: 'invalid_score' });
    }

    // tablo yoksa oluştur
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

    // upsert: best = GREATEST(old.best, new.score)
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
