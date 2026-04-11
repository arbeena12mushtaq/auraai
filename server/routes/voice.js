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

const DID_VOICES = {
  'Soft & Gentle': { type: 'microsoft', voice_id: 'Sara' },
  'Warm & Rich': { type: 'microsoft', voice_id: 'Aria' },
  'Bright & Cheerful': { type: 'microsoft', voice_id: 'Jenny' },
  'Calm & Soothing': { type: 'microsoft', voice_id: 'Emma' },
  'Deep & Confident': { type: 'microsoft', voice_id: 'Guy' },
};

// ====== TTS — text to speech ======
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
    if (!r.ok) { console.error('TTS err:', r.status); return res.status(500).json({ error: 'TTS failed' }); }

    const buf = Buffer.from(await r.arrayBuffer());
    const fn = `tts-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(uploadDir, fn), buf);
    console.log(`✅ TTS: ${fn} (${Math.round(buf.length/1024)}KB)`);
    res.json({ audio_url: `/uploads/${fn}` });
  } catch (e) { console.error('TTS:', e.message); res.status(500).json({ error: 'TTS failed' }); }
});

// ====== STT — speech to text (user voice notes) ======
router.post('/stt', authMiddleware, audioUpload.single('audio'), async (req, res) => {
  let tempPath = null;
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Not configured' });

    if (!req.file) return res.status(400).json({ error: 'No audio file' });
    tempPath = req.file.path;

    // Rename to have proper extension
    const newPath = tempPath + '.webm';
    fs.renameSync(tempPath, newPath);
    tempPath = newPath;

    // Use form-data for multipart upload to OpenAI
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(tempPath), { filename: 'voice.webm', contentType: 'audio/webm' });
    form.append('model', 'whisper-1');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...form.getHeaders() },
      body: form,
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('STT err:', r.status, errText);
      return res.status(500).json({ error: 'Transcription failed' });
    }

    const data = await r.json();
    console.log(`🎙️ STT: "${(data.text || '').substring(0, 60)}"`);
    res.json({ text: data.text || '' });
  } catch (e) {
    console.error('STT:', e.message);
    res.status(500).json({ error: 'Transcription failed' });
  } finally {
    if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
  }
});

// ====== D-ID talking avatar ======
router.post('/talking-avatar', authMiddleware, async (req, res) => {
  try {
    const { text, image_url, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const didKey = process.env.DID_API_KEY;
    if (!didKey) return res.status(400).json({ error: 'D-ID not configured', fallback: 'tts' });

    let sourceUrl = image_url || '';
    if (sourceUrl.startsWith('/uploads/')) {
      const host = process.env.CLIENT_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
      sourceUrl = host ? `${host}${sourceUrl}` : '';
    }
    if (!sourceUrl || sourceUrl.includes('pravatar')) {
      sourceUrl = 'https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/image.jpeg';
    }

    const dv = DID_VOICES[voice] || DID_VOICES['Soft & Gentle'];
    console.log(`🎬 D-ID: creating talk...`);

    const cr = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${didKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_url: sourceUrl,
        script: { type: 'text', input: text.substring(0, 500), provider: { type: dv.type, voice_id: dv.voice_id } },
        config: { fluent: true },
      }),
    });

    if (!cr.ok) {
      const e = await cr.text();
      console.error('D-ID create err:', cr.status, e);
      return res.status(500).json({ error: 'Avatar failed', fallback: 'tts' });
    }

    const { id } = await cr.json();
    console.log(`   Talk: ${id}`);

    let videoUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pr = await fetch(`https://api.d-id.com/talks/${id}`, { headers: { 'Authorization': `Basic ${didKey}` } });
      if (!pr.ok) continue;
      const pd = await pr.json();
      if (pd.status === 'done') { videoUrl = pd.result_url; break; }
      if (pd.status === 'error') { console.error('D-ID proc err:', pd.error); break; }
    }

    if (!videoUrl) return res.status(500).json({ error: 'Timed out', fallback: 'tts' });
    console.log(`✅ D-ID video ready`);
    res.json({ video_url: videoUrl });
  } catch (e) {
    console.error('D-ID:', e.message);
    res.status(500).json({ error: 'Avatar failed', fallback: 'tts' });
  }
});

module.exports = router;
