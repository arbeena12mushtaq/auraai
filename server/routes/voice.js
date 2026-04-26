const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const audioUpload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

const TTS_VOICES = {
  'Soft & Gentle': 'nova', 'Warm & Rich': 'shimmer', 'Bright & Cheerful': 'alloy',
  'Calm & Soothing': 'echo', 'Deep & Confident': 'onyx',
};

function getBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

// TTS
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const k = process.env.OPENAI_API_KEY;
    if (!k) {
      console.error('❌ Voice TTS: OPENAI_API_KEY is not set');
      return res.status(500).json({ error: 'Voice chat is not configured. OPENAI_API_KEY is missing.' });
    }
    console.log('🎤 TTS request: voice=', TTS_VOICES[voice] || 'nova', 'textLen=', text.length);
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text.substring(0, 4096), voice: TTS_VOICES[voice] || 'nova', response_format: 'mp3' }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('❌ TTS API failed:', r.status, errText.slice(0, 300));
      return res.status(500).json({ error: `TTS failed: ${r.status}` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const fn = `tts-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(uploadDir, fn), buf);
    const audioUrl = `${getBaseUrl(req)}/uploads/${fn}`;
    console.log('✅ TTS audio generated:', audioUrl);
    res.json({ audio_url: audioUrl });
  } catch (e) {
    console.error('❌ TTS error:', e.message);
    res.status(500).json({ error: `TTS failed: ${e.message}` });
  }
});

// STT
router.post('/stt', authMiddleware, audioUpload.single('audio'), async (req, res) => {
  let tp = null;
  try {
    const k = process.env.OPENAI_API_KEY;
    if (!k) {
      console.error('❌ Voice STT: OPENAI_API_KEY is not set');
      return res.json({ text: '', error: 'Voice chat is not configured. OPENAI_API_KEY is missing.' });
    }
    if (!req.file) return res.json({ text: '', error: 'No audio file received' });
    tp = req.file.path;
    const np = tp + '.webm';
    fs.renameSync(tp, np);
    tp = np;
    const fb = fs.readFileSync(tp);
    const fd = new FormData();
    fd.append('file', new Blob([fb], { type: 'audio/webm' }), 'voice.webm');
    fd.append('model', 'whisper-1');
    console.log('🎤 STT request: audioSize=', fb.length);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${k}` }, body: fd,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('❌ STT API failed:', r.status, errText.slice(0, 300));
      return res.json({ text: '', error: `STT failed: ${r.status}` });
    }
    const d = await r.json();
    console.log('✅ STT transcribed:', d.text?.slice(0, 50));
    res.json({ text: d.text || '' });
  } catch (e) {
    console.error('❌ STT error:', e.message);
    res.json({ text: '', error: `STT failed: ${e.message}` });
  }
  finally { if (tp) try { fs.unlinkSync(tp); } catch {} }
});

// Save voice message to DB for persistence
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { companionId, audioUrl, content } = req.body;
    if (!companionId || !audioUrl) return res.status(400).json({ error: 'Missing fields' });
    
    // Save the audio message so it appears on refresh
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'audio',$4)`,
      [req.user.id, companionId, content || '🔊', audioUrl]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Save voice msg error:', e.message);
    res.status(500).json({ error: 'Failed to save voice message' });
  }
});

module.exports = router;
