// api/score.js
const crypto = require('crypto');
const { sql } = require('@vercel/postgres');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

/** Token doğrulama (hem yeni "b64.payload.sig" hem eski "seed:ts:sig" formatını destekler) */
function verifySessionToken(token) {
  if (!token) throw new Error('bad_token');
  if (token.includes('.')) {
    const [b64, sig] = token.split('.');
    const payload = Buffer.from(b64, 'base64url').toString('utf8');
    const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    if (sig !== expect) throw new Error('bad_sig');
    const obj = JSON.parse(payload);
    if (!obj.seed || !obj.iat) throw new Error('bad_payload');
    if (Date.now() - obj.iat > 5 * 60 * 1000) throw new Error('expired'); // 5 dk
    return { seed: obj.seed };
  }
  const parts = token.split(':');
  if (parts.length !== 3) throw new Error('bad_token');
  const [seed, ts, sig] = parts;
  const expect = crypto.createHmac('sha256', SECRET).update(`${seed}:${ts}`).digest('hex');
  if (sig !== expect) throw new Error('bad_sig');
  return { seed };
}

/** Deterministik RNG (xorshift32) */
function makeRngFromHexSeed(hex) {
  const hi = parseInt(hex.slice(0,8),16) | 0;
  const lo = parseInt(hex.slice(8),16) | 0;
  let s = (hi ^ lo) >>> 0 || 0x6d2b79f5;
  return function() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 0x100000000;
  };
}

/** Sunucuda koşuyu simüle et (oyun fiziğin birebir) */
function simulateRun({ seed, inputs, W, H, SCALE }) {
  const rng = makeRngFromHexSeed(seed);
  const BASE = { GRAV:1800, FLAP:-520, PIPE_W:72, GAP_FRAC:0.28, SCROLL:220 };
  let GRAV=BASE.GRAV*SCALE, FLAP=BASE.FLAP*SCALE;
  let PIPE_W=Math.max(44, Math.floor(BASE.PIPE_W*SCALE));
  let BASE_GAP=Math.max(130*SCALE, Math.floor(H*BASE.GAP_FRAC));
  let PIPE_GAP=BASE_GAP, SCROLL=BASE.SCROLL*SCALE, BASE_SPACING=440*SCALE;

  const bird={ x:Math.floor(Math.min(W*0.25,240*SCALE)), y:Math.floor(H/2), vy:0, r:Math.max(20,Math.floor(24*SCALE)) };
  let pipes=[], score=0, t=0;

  function spawnPipe(){
    const min=40*SCALE, max=H-PIPE_GAP-40*SCALE;
    pipes.push({ x:W+50, top:min + (max-min)*rng(), passed:false });
  }
  function circleRect(cx,cy,r,rx,ry,rw,rh){
    const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh));
    const dx=cx-nx,dy=cy-ny; return dx*dx+dy*dy<=r*r;
  }

  // ---- FLAP zamanlaması: ilk flap'ı 0'a hizala (client READY beklemesi çıkar)
  const rawFlaps = Array.isArray(inputs.flapsMs)
    ? inputs.flapsMs.map(v => Math.max(0, Math.floor(v))).sort((a,b)=>a-b)
    : [];
  const offset = rawFlaps.length ? rawFlaps[0] : 0;
  const flaps = rawFlaps.map(v => v - offset); // şimdi ilk flap = 0
  let fi = 0;

  const dt=8.333, dtSec=dt/1000;
  // duration'dan offset'i çıkar (client tarafındaki başlangıç gecikmesi düşülür)
  const dur = Math.max(0, (inputs.durationMs|0) - offset);
  const totalMs = Math.min(Math.max(1000, dur), 10*60*1000);
  let ms=0, alive=true;

  while(alive && ms<=totalMs){
    // bu frame aralığı [ms, ms+dt)
    const nextEdge = ms + dt + 1e-6;
    while (fi < flaps.length && flaps[fi] >= ms && flaps[fi] < nextEdge) {
      bird.vy = FLAP;   // aynı frame'de birden fazla flap varsa hepsi işlenir
      fi++;
    }

    // spawn zamanlaması
    let spacing=BASE_SPACING;
    if (score>=50) spacing*=0.82; else if (score>=30) spacing*=0.90;
    const SPAWN_EVERY=Math.max(0.55, spacing/SCROLL);
    t+=dtSec; if(t>=SPAWN_EVERY){ t=0; spawnPipe(); }

    // hız artışı
    const lvl = (score>=30)? Math.min(10,3+Math.floor((score-30)/5)) :
                 (score>=10)? Math.min(10,1+Math.floor((score-10)/10)) : 0;
    let speedMul = 1 + 0.08*lvl + 0.015*(lvl*lvl);
    if (score>=50){
      const hard=(score-50)/5;
      const hardMul=1 + 0.12*hard + 0.06*(hard*hard);
      speedMul=Math.min(speedMul*hardMul, 3.8);
    }
    SCROLL = BASE.SCROLL*SCALE*speedMul;

    // gap daralması
    const STEP_GAP=14*SCALE, MIN_GAP=90*SCALE;
    const gapStep=Math.floor(score/20);
    let targetGap=BASE_GAP - gapStep*STEP_GAP;
    if (score>=50) targetGap -= (score-50)*(0.8*SCALE);
    PIPE_GAP=Math.max(MIN_GAP, Math.floor(targetGap));

    // boruları hareket ettir
    for(let i=pipes.length-1;i>=0;i--){
      const p=pipes[i];
      p.x-=SCROLL*dtSec;
      if(!p.passed && p.x+PIPE_W<bird.x){ p.passed=true; score++; }
      if(p.x+PIPE_W<-60) pipes.splice(i,1);
    }

    // kuş fiziği
    bird.vy+=GRAV*dtSec; bird.y+=bird.vy*dtSec;

    // çarpışma
    if(bird.y-bird.r<=0 || bird.y+bird.r>=H){ alive=false; break; }
    for(const p of pipes){
      if (circleRect(bird.x,bird.y,bird.r, p.x,0,PIPE_W,p.top) ||
          circleRect(bird.x,bird.y,bird.r, p.x,p.top+PIPE_GAP,PIPE_W, H-(p.top+PIPE_GAP))) { alive=false; break; }
    }

    ms += dt;
  }

  // Ölüm anında geometrik olarak "geride kalmış" boruları tekrar say (frame farklarını düzeltmek için)
  try {
    const passedByGeom = pipes.reduce((n, p) => n + ((p.x + PIPE_W) < bird.x ? 1 : 0), 0);
    if (passedByGeom > score) score = passedByGeom;
  } catch (e) {
    // hiç kritik değil, devam et
  }

  return { score: Math.max(0, Math.floor(score)) };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow','POST');
      return res.status(405).json({ ok:false, error:'method_not_allowed' });
    }

    const { name, sessionToken, seed, inputs, W, H, SCALE } = req.body || {};
    const n = (name || '').trim();
    if (n.length < 3 || n.length > 20) return res.status(400).json({ ok:false, error:'invalid_name' });
    if (!sessionToken || !seed)       return res.status(400).json({ ok:false, error:'missing_token_seed' });
    if (!inputs || !Array.isArray(inputs.flapsMs) || !Number.isFinite(W) || !Number.isFinite(H) || !Number.isFinite(SCALE)) {
      return res.status(400).json({ ok:false, error:'bad_inputs' });
    }

    // tablolar (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGSERIAL PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        seed TEXT NOT NULL,
        iat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        consumed_at TIMESTAMPTZ
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        best INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scores_best ON scores(best DESC);`;

    // token doğrulama + anti-replay
    const sess = verifySessionToken(sessionToken);
    if (sess.seed !== seed) return res.status(400).json({ ok:false, error:'seed_mismatch' });

    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const { rows: srows } = await sql`
      SELECT consumed_at FROM sessions WHERE token_hash=${tokenHash} LIMIT 1;
    `;
    if (!srows.length)  return res.status(400).json({ ok:false, error:'unknown_token' });
    if (srows[0].consumed_at) return res.status(400).json({ ok:false, error:'token_used' });

    // simülasyon
    const { score: verifiedScore } = simulateRun({ seed, inputs, W, H, SCALE });

    // token'ı her durumda tüket (tekrar replay engellemek için)
    await sql`UPDATE sessions SET consumed_at = NOW() WHERE token_hash=${tokenHash};`;

    // 0 skoru yazma ama token tüketildi (client için bilgi döndür)
    if (verifiedScore <= 0) {
      return res.status(200).json({ ok: true, best: null, verifiedScore });
    }

    // aşırı uç kontrol
    const sps = verifiedScore / Math.max(1, (inputs.durationMs/1000));
    if (verifiedScore > 2000 || sps > 8) {
      return res.status(400).json({ ok:false, error:'implausible' });
    }

    // sadece en yüksek skoru tut (upsert)
    let returnedBest = null;
    try {
      const { rows } = await sql`
        INSERT INTO scores (name, best)
        VALUES (${n}, ${verifiedScore})
        ON CONFLICT (name)
        DO UPDATE SET best = GREATEST(scores.best, EXCLUDED.best), updated_at = NOW()
        RETURNING best;
      `;
      returnedBest = rows && rows[0] ? rows[0].best : null;
    } catch (e) {
      console.error('DB upsert failed', { name: n, verifiedScore, err: e && e.message });
      return res.status(500).json({ ok:false, error:'db_error' });
    }

    return res.status(200).json({ ok:true, best: returnedBest, verifiedScore });
  } catch (e) {
    console.error('score handler error', e && e.stack ? e.stack : e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};
