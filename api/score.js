const crypto = require('crypto');
const { sql } = require('@vercel/postgres');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

// Token doğrulama
function verifySessionToken(token) {
  const [b64, sig] = String(token || '').split('.');
  if (!b64 || !sig) throw new Error('bad_token');
  const payload = Buffer.from(b64, 'base64url').toString('utf8');
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (sig !== expect) throw new Error('bad_sig');
  const obj = JSON.parse(payload);
  if (!obj.seed || !obj.iat) throw new Error('bad_payload');
  if (Date.now() - obj.iat > 5 * 60 * 1000) throw new Error('expired');
  return obj;
}

// Deterministik RNG
function makeRngFromHexSeed(hex) {
  const hi = parseInt(hex.slice(0, 8), 16) | 0;
  const lo = parseInt(hex.slice(8), 16) | 0;
  let s = (hi ^ lo) >>> 0 || 0x6d2b79f5;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 0x100000000;
  };
}

// Simülasyon — client ve server aynı fizik
function simulateRun({ seed, inputs, W, H, SCALE }) {
  const rng = makeRngFromHexSeed(seed);
  const BASE = { GRAV: 1800, FLAP: -520, PIPE_W: 72, GAP_FRAC: 0.28, SCROLL: 220 };
  let GRAV = BASE.GRAV * SCALE;
  let FLAP = BASE.FLAP * SCALE;
  let PIPE_W = Math.max(44, Math.floor(BASE.PIPE_W * SCALE));
  let BASE_GAP = Math.max(130 * SCALE, Math.floor(H * BASE.GAP_FRAC));
  let PIPE_GAP = BASE_GAP;
  let SCROLL = BASE.SCROLL * SCALE;
  let BASE_SPACING = 440 * SCALE;
  const bird = { x: Math.floor(Math.min(W * 0.25, 240 * SCALE)), y: Math.floor(H / 2), vy: 0, r: Math.max(20, Math.floor(24 * SCALE)) };
  let pipes = [], score = 0, t = 0;

  function spawnPipe() {
    const min = 40 * SCALE, max = H - PIPE_GAP - 40 * SCALE;
    pipes.push({ x: W + 50, top: min + (max - min) * rng(), passed: false });
  }
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  const dt = 8.333, dtSec = dt / 1000;
  const flapSet = new Set((inputs.flapsMs || []).map(x => Math.floor(x)));
  const totalMs = Math.min(Math.max(1000, inputs.durationMs | 0), 10 * 60 * 1000);
  let ms = 0, alive = true;

  while (alive && ms <= totalMs) {
    if (flapSet.has(ms)) bird.vy = FLAP;

    let spacing = BASE_SPACING;
    if (score >= 50) spacing *= 0.82; else if (score >= 30) spacing *= 0.9;
    const SPAWN_EVERY = Math.max(0.55, spacing / SCROLL);
    t += dtSec; if (t >= SPAWN_EVERY) { t = 0; spawnPipe(); }

    const lvl = (score >= 30) ? Math.min(10, 3 + Math.floor((score - 30) / 5))
                : (score >= 10) ? Math.min(10, 1 + Math.floor((score - 10) / 10))
                : 0;
    let speedMul = 1 + 0.08 * lvl + 0.015 * (lvl * lvl);
    if (score >= 50) {
      const hard = (score - 50) / 5;
      const hardMul = 1 + 0.12 * hard + 0.06 * (hard * hard);
      speedMul = Math.min(speedMul * hardMul, 3.8);
    }
    SCROLL = BASE.SCROLL * SCALE * speedMul;

    const STEP_GAP = 14 * SCALE, MIN_GAP = 90 * SCALE;
    const gapStep = Math.floor(score / 20);
    let targetGap = BASE_GAP - gapStep * STEP_GAP;
    if (score >= 50) targetGap -= (score - 50) * (0.8 * SCALE);
    PIPE_GAP = Math.max(MIN_GAP, Math.floor(targetGap));

    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= SCROLL * dtSec;
      if (!p.passed && p.x + PIPE_W < bird.x) { p.passed = true; score++; }
      if (p.x + PIPE_W < -60) pipes.splice(i, 1);
    }

    bird.vy += GRAV * dtSec;
    bird.y += bird.vy * dtSec;

    if (bird.y - bird.r <= 0 || bird.y + bird.r >= H) { alive = false; break; }
    for (const p of pipes) {
      if (circleRect(bird.x,bird.y,bird.r,p.x,0,PIPE_W,p.top) ||
          circleRect(bird.x,bird.y,bird.r,p.x,p.top+PIPE_GAP,PIPE_W,H-(p.top+PIPE_GAP))) {
        alive = false; break;
      }
    }
    ms += dt;
  }
  return { score };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }

    const { name, sessionToken, seed, inputs, W, H, SCALE } = req.body || {};
    const n = (name || '').trim();

    if (n.length < 3 || n.length > 20) return res.status(400).json({ ok:false, error:'invalid_name' });
    if (!sessionToken || !seed) return res.status(400).json({ ok:false, error:'missing_token_seed' });

    const sess = verifySessionToken(sessionToken);
    if (sess.seed !== seed) return res.status(400).json({ ok:false, error:'seed_mismatch' });
    if (!inputs || !Array.isArray(inputs.flapsMs)) return res.status(400).json({ ok:false, error:'bad_inputs' });

    const { score: verifiedScore } = simulateRun({ seed, inputs, W, H, SCALE });
    const sps = verifiedScore / (inputs.durationMs / 1000);
    if (verifiedScore > 2000 || sps > 8) return res.status(400).json({ ok:false, error:'implausible' });

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

    const { rows } = await sql`
      INSERT INTO scores (name, best)
      VALUES (${n}, ${verifiedScore})
      ON CONFLICT (name)
      DO UPDATE SET best = GREATEST(scores.best, EXCLUDED.best), updated_at = NOW()
      RETURNING best;
    `;

    return res.status(200).json({ ok:true, best: rows[0].best, verifiedScore });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};
