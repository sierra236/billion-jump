const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const TTL_MS = 5 * 60 * 1000; // 5 dakika

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }

    const seed = crypto.randomBytes(8).toString('hex'); // 64-bit hex seed
    const payload = JSON.stringify({ seed, iat: Date.now() });
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    const sessionToken = Buffer.from(payload).toString('base64url') + '.' + sig;

    return res.status(200).json({ ok:true, seed, sessionToken, expiresIn: TTL_MS });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};
