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

// TTS — returns MP3 audio
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Not configured' });

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text.substring(0, 4096), voice: TTS_VOICES[voice] || 'nova', response_format: 'mp3' }),
    });
    if (!r.ok) { console.error('TTS err:', r.status); return res.status(500).json({ error: 'Failed' }); }

    const buf = Buffer.from(await r.arrayBuffer());
    const fn = `tts-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(uploadDir, fn), buf);
    console.log(`✅ TTS: ${fn}`);
    res.json({ audio_url: `/uploads/${fn}` });
  } catch (e) { console.error('TTS:', e.message); res.status(500).json({ error: 'Failed' }); }
});

// TTS as PCM16 raw audio (for Simli — needs PCM16 16kHz)
router.post('/tts-pcm', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Not configured' });

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text.substring(0, 4096), voice: TTS_VOICES[voice] || 'nova', response_format: 'pcm' }),
    });
    if (!r.ok) { console.error('TTS-PCM err:', r.status); return res.status(500).json({ error: 'Failed' }); }

    const buf = Buffer.from(await r.arrayBuffer());
    const fn = `tts-pcm-${Date.now()}.raw`;
    fs.writeFileSync(path.join(uploadDir, fn), buf);

    // Also save as mp3 for fallback audio playback
    const r2 = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text.substring(0, 4096), voice: TTS_VOICES[voice] || 'nova', response_format: 'mp3' }),
    });
    let mp3Url = null;
    if (r2.ok) {
      const mp3Buf = Buffer.from(await r2.arrayBuffer());
      const mp3Fn = `tts-${Date.now()}.mp3`;
      fs.writeFileSync(path.join(uploadDir, mp3Fn), mp3Buf);
      mp3Url = `/uploads/${mp3Fn}`;
    }

    console.log(`✅ TTS-PCM: ${fn}`);
    res.json({ pcm_url: `/uploads/${fn}`, audio_url: mp3Url });
  } catch (e) { console.error('TTS-PCM:', e.message); res.status(500).json({ error: 'Failed' }); }
});

// STT — transcribe voice note
router.post('/stt', authMiddleware, audioUpload.single('audio'), async (req, res) => {
  let tempPath = null;
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Not configured' });
    if (!req.file) return res.status(400).json({ error: 'No audio' });
    tempPath = req.file.path;
    const newPath = tempPath + '.webm';
    fs.renameSync(tempPath, newPath);
    tempPath = newPath;

    const fileBuffer = fs.readFileSync(tempPath);
    const blob = new Blob([fileBuffer], { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('file', blob, 'voice.webm');
    formData.append('model', 'whisper-1');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });
    if (!r.ok) { console.error('STT err:', r.status, await r.text()); return res.status(500).json({ error: 'Failed' }); }
    const data = await r.json();
    console.log(`✅ STT: "${(data.text || '').substring(0, 60)}"`);
    res.json({ text: data.text || '' });
  } catch (e) { console.error('STT:', e.message); res.status(500).json({ error: 'Failed' }); }
  finally { if (tempPath) try { fs.unlinkSync(tempPath); } catch {} }
});

// Get Simli config for frontend
router.get('/simli-config', authMiddleware, (req, res) => {
  const key = process.env.SIMLI_API_KEY;
  if (!key) return res.json({ available: false });
  res.json({ available: true, apiKey: key });
});

module.exports = router;
