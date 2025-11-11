// api/leaderboard.js
const { sql } = require('@vercel/postgres');

module.exports = async (req, res) => {
  try {
    // LB cevabını cache’leme (geliştirirken net görmek için)
    res.setHeader('Cache-Control', 'no-store');

    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scores_best ON scores(best DESC);`;

    // Sadece pozitif skorlar, ilk 20
    const { rows } = await sql`
      SELECT name, best
      FROM scores
      WHERE best > 0
      ORDER BY best DESC, updated_at ASC
      LIMIT 20;
    `;

    return res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
