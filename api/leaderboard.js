// /api/leaderboard.js
const { sql } = require('@vercel/postgres');
module.exports.config = { runtime: 'nodejs' };

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = (url.searchParams.get('name') || '').trim();
    const LIMIT = 20;

    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Top 20
    const { rows: top } = await sql`
      SELECT name, best
      FROM scores
      ORDER BY best DESC, updated_at ASC
      LIMIT ${LIMIT};
    `;

    let you = null;
    if (name) {
      // rank hesapla
      const { rows: yr } = await sql`
        SELECT name, best, rank
        FROM (
          SELECT name, best,
                 RANK() OVER (ORDER BY best DESC, updated_at ASC) AS rank
          FROM scores
        ) t
        WHERE name = ${name}
        LIMIT 1;
      `;
      if (yr.length) {
        you = { name: yr[0].name, best: yr[0].best, rank: Number(yr[0].rank) };
      }
    }

    return res.status(200).json({ ok:true, rows: top, you });
  } catch (e) {
    console.error('leaderboard error:', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};
