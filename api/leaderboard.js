const { sql } = require('@vercel/postgres');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 100)));

    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(name)
      );
    `;

    const { rows } = await sql`
      SELECT name, best
      FROM scores
      ORDER BY best DESC, updated_at ASC
      LIMIT ${limit};
    `;

    return res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
