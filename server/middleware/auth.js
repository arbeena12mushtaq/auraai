const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'aura-ai-secret-key-change-in-production';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Content safety filter
function contentFilter(text) {
  const blocked = /\b(sex|nude|naked|porn|xxx|nsfw|explicit|erotic|fetish|kink|hentai|onlyfans)\b/i;
  return !blocked.test(text);
}

module.exports = { generateToken, authMiddleware, adminMiddleware, contentFilter, JWT_SECRET };
