const crypto = require('crypto');
const cookie = require('cookie');

const COOKIE_NAME = 'lp_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set. See .env.example.');
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

function createSessionCookie(secure) {
  const payload = String(Date.now() + MAX_AGE_MS);
  const value = `${payload}.${sign(payload)}`;
  return cookie.serialize(COOKIE_NAME, value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS / 1000,
  });
}

function clearSessionCookie() {
  return cookie.serialize(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}

function verifySession(value) {
  if (!value) return false;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;

  const expectedSig = sign(payload);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  const expires = Number(payload);
  return Number.isFinite(expires) && Date.now() < expires;
}

function requireAuth(req, res, next) {
  const cookies = cookie.parse(req.headers.cookie || '');
  if (verifySession(cookies[COOKIE_NAME])) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/login');
}

function handleLogin(req, res) {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const expected = process.env.DASHBOARD_PASSWORD || '';

  const passBuf = Buffer.from(password);
  const expBuf = Buffer.from(expected);
  const ok = expected.length > 0 && passBuf.length === expBuf.length && crypto.timingSafeEqual(passBuf, expBuf);

  if (!ok) {
    return res.redirect('/login?error=1');
  }

  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', createSessionCookie(secure));
  res.redirect('/');
}

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.redirect('/login');
}

module.exports = { requireAuth, handleLogin, handleLogout };
