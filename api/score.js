// /api/score.js
const { sql } = require('@vercel/postgres');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // JSON body: { name, score }
    const { name, score } = req.body || {};
    const n = String(name || '').trim();
    let s = Number(score);

    // Basit kontroller (tamamen kapatmak istersen bunları da sil)
    if (n.length < 2 || n.length > 20) {
      return res.status(400).json({ ok: false, error: 'invalid_name' });
    }
    if (!Number.isFinite(s)) s = 0;
    s = Math.max(0, Math.floor(s));           // negatif/ondalık temizle
    if (s > 1e9) s = 1e9;                      // üst sınır (istersen kaldır)

    // Tabloyu oluştur (idempotent)
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

    // Upsert: en yükseği tut
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
