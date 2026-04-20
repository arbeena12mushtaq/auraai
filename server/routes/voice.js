const express = require('express');
const fs = require('fs');
const path = require('path');
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

// TTS
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const k = process.env.OPENAI_API_KEY;
    if (!k) return res.status(400).json({ error: 'Not configured' });
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text.substring(0, 4096), voice: TTS_VOICES[voice] || 'nova', response_format: 'mp3' }),
    });
    if (!r.ok) return res.status(500).json({ error: 'TTS failed' });
    const buf = Buffer.from(await r.arrayBuffer());
    const fn = `tts-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(uploadDir, fn), buf);
    res.json({ audio_url: `/uploads/${fn}` });
  } catch (e) { console.error('TTS error:', e.message); res.status(500).json({ error: 'TTS failed' }); }
});

// STT
router.post('/stt', authMiddleware, audioUpload.single('audio'), async (req, res) => {
  let tp = null;
  try {
    const k = process.env.OPENAI_API_KEY;
    if (!k || !req.file) return res.json({ text: '', error: 'Not configured' });
    tp = req.file.path;
    const np = tp + '.webm';
    fs.renameSync(tp, np);
    tp = np;
    const fb = fs.readFileSync(tp);
    const fd = new FormData();
    fd.append('file', new Blob([fb], { type: 'audio/webm' }), 'voice.webm');
    fd.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${k}` }, body: fd,
    });
    if (!r.ok) return res.json({ text: '', error: 'STT failed' });
    const d = await r.json();
    res.json({ text: d.text || '' });
  } catch (e) { console.error('STT error:', e.message); res.json({ text: '', error: 'STT failed' }); }
  finally { if (tp) try { fs.unlinkSync(tp); } catch {} }
});

module.exports = router;
