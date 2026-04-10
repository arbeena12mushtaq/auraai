require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

let dbReady = false;

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    dbReady,
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companions', require('./routes/companions'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/image', require('./routes/imageGen'));

// Serve React frontend in production
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }

  res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
    if (err) {
      res.status(500).send('Frontend not built or index.html missing');
    }
  });
});

// Start server immediately
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Aura AI Server running on port ${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 http://0.0.0.0:${PORT}\n`);

  try {
    await initDatabase();
    dbReady = true;
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database init failed:', err);
  }
});
