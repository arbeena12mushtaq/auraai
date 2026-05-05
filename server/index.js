require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's reverse proxy
app.set('trust proxy', 1);

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));

// Parse JSON for all routes EXCEPT Stripe webhook (needs raw body for signature verification)
app.use((req, res, next) => {
  if (req.path === '/api/payments/webhook') return next();
  express.json({ limit: '25mb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/api/payments/webhook') return next();
  express.urlencoded({ extended: true, limit: '25mb' })(req, res, next);
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Serve uploaded files — silently 404 missing files (Railway wipes /uploads on redeploy)
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
app.use('/uploads', express.static(uploadsPath, { fallthrough: true }));
app.use('/uploads', (req, res) => res.status(404).end());

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companions', require('./routes/companions'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/admin', require('./routes/admin'));
const imageGenRouter = require('./routes/imageGen');
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET', // Skip rate limit for GET (job polling)
  message: {
    success: false,
    error: 'Please wait before regenerating another image.',
    code: 'IMAGE_RATE_LIMIT'
  }
});
app.use('/api/image', imageLimiter, imageGenRouter);
app.use('/api/voice', require('./routes/voice'));
// Health check
const app = express();
const PORT = process.env.PORT || 3001;

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
// Serve React frontend
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 Aura AI Server running on port ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}\n`);

  try {
    await initDatabase();
    console.log('✅ Database initialized successfully');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
  }
});

start();
