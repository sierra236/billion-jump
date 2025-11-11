// api/score.js
const crypto = require("crypto");
const { sql } = require("@vercel/postgres");

const SECRET = process.env.SESSION_SECRET;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const { name, score, sessionToken } = req.body || {};
    if (!name || !sessionToken) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const parts = sessionToken.split(":");
    if (parts.length !== 3)
      return res.status(400).json({ ok: false, error: "invalid_token" });

    const [seed, timestamp, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", SECRET)
      .update(`${seed}:${timestamp}`)
      .digest("hex");

    if (signature !== expectedSig)
      return res.status(400).json({ ok: false, error: "bad_signature" });

    const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    const { rows } = await sql`
      SELECT * FROM sessions WHERE token_hash = ${tokenHash} LIMIT 1;
    `;
    if (!rows.length)
      return res.status(400).json({ ok: false, error: "unknown_token" });
    if (rows[0].consumed_at)
      return res.status(400).json({ ok: false, error: "token_already_used" });

    await sql`
      UPDATE sessions SET consumed_at = NOW() WHERE token_hash = ${tokenHash};
    `;

    const s = Number(score);
    if (!Number.isFinite(s) || s < 0 || s > 100000)
      return res.status(400).json({ ok: false, error: "invalid_score" });

    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scores_best ON scores(best DESC);`;

    // upsert: en iyi skoru tut
    const result = await sql`
      INSERT INTO scores (name, best)
      VALUES (${name}, ${s})
      ON CONFLICT (name)
      DO UPDATE SET best = GREATEST(scores.best, EXCLUDED.best), updated_at = NOW()
      RETURNING best;
    `;

    return res.status(200).json({ ok: true, best: result.rows[0].best });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
};
