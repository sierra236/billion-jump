// /api/leaderboard.js
import { sql } from '@vercel/postgres';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const me = (url.searchParams.get('me') || '').trim();

    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    const { rows: top } = await sql`
      SELECT name, best
      FROM scores
      ORDER BY best DESC, updated_at ASC
      LIMIT ${limit};
    `;

    let you = null;
    let inTop = false;

    if (me) {
      inTop = top.some(r => r.name === me);
      if (!inTop) {
        const { rows: mine } = await sql`
          SELECT name, best FROM scores WHERE name=${me} LIMIT 1;
        `;
        if (mine.length) you = mine[0];
      }
    }

    return res.status(200).json({ ok: true, rows: top, you, inTop });
  } catch (e) {
    console.error('leaderboard error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
