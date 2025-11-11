// api/session.js
const crypto = require("crypto");
const { sql } = require("@vercel/postgres");

const SECRET = process.env.SESSION_SECRET;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const seed = crypto.randomBytes(16).toString("hex");
    const timestamp = Date.now().toString();
    const payload = `${seed}:${timestamp}`;
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(payload)
      .digest("hex");
    const token = `${payload}:${signature}`;

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        seed TEXT NOT NULL,
        iat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        consumed_at TIMESTAMPTZ
      );
    `;

    await sql`
      INSERT INTO sessions (token_hash, seed)
      VALUES (${tokenHash}, ${seed})
      ON CONFLICT (token_hash) DO NOTHING;
    `;

    return res.status(200).json({
      ok: true,
      seed,
      sessionToken: token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
};
