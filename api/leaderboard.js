const { sql } = require('@vercel/postgres');

module.exports = async (req, res) => {
  try {
    // sadece ilk 20 gösterilecek
    const limit = 20;

    // tablo yoksa oluştur
    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // en yüksek 20 skor
    const { rows } = await sql`
      SELECT name, best
      FROM scores
      ORDER BY best DESC, updated_at ASC
      LIMIT ${limit};
    `;

    // vercel edge cache (isteğe bağlı)
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

    return res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
