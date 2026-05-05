const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const sttTempDir = path.join(uploadDir, 'stt-temp');
if (!fs.existsSync(sttTempDir)) fs.mkdirSync(sttTempDir, { recursive: true });

const TTS_VOICES = {
  'Soft & Feminine': 'nova',
  'Warm & Natural': 'shimmer',
  'Calm & Mature': 'fable',
  'Flirty & Light': 'alloy',
  'Deep Male': 'onyx',
  'Friendly Female': 'nova',
  'Cute & Young': 'shimmer',
};

const EDGE_VOICES = {
  'nova': 'en-US-JennyNeural',
  'shimmer': 'en-US-AriaNeural',
  'fable': 'en-US-SaraNeural',
  'alloy': 'en-US-AnaNeural',
  'onyx': 'en-US-GuyNeural',
};

function getBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function cleanForTTS(text) {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/\*[^*]+\*/g, '')
    .replace(/~[^~]+~/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Hey there!';
}


// =============================================
//  STT — OpenAI Whisper (REAL transcription)
// =============================================
const sttUpload = multer({
  dest: sttTempDir,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('audio/') || file.mimetype?.startsWith('video/')) cb(null, true);
    else cb(new Error('Audio files only'), false);
  },
});

router.post('/stt', authMiddleware, sttUpload.single('audio'), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ text: '', error: 'No audio file' });

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.log('⚠️ STT: OPENAI_API_KEY not set');
      if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
      return res.json({ text: '' });
    }

    console.log('🎙️ STT: Transcribing voice...', {
      mime: req.file.mimetype,
      size: `${Math.round(req.file.size / 1024)}KB`,
    });

    const audioBuffer = fs.readFileSync(tempPath);
    const mime = req.file.mimetype || 'audio/webm';
    let ext = 'webm';
    if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
    else if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('mp3') || mime.includes('mpeg')) ext = 'mp3';

    // Use Node 18+ native FormData + Blob
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mime });
    formData.append('file', blob, `recording.${ext}`);
    formData.append('model', 'whisper-1');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Cleanup temp
    if (tempPath) try { fs.unlinkSync(tempPath); } catch {}

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => '');
      console.error('❌ STT Whisper error:', whisperRes.status, errText.substring(0, 300));
      return res.json({ text: '', error: `Whisper ${whisperRes.status}` });
    }

    const result = await whisperRes.json();
    const transcript = (result.text || '').trim();
    console.log('✅ STT result:', transcript.substring(0, 120));

    return res.json({ text: transcript });
  } catch (err) {
    console.error('❌ STT error:', err.message);
    if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
    return res.json({ text: '', error: err.message });
  }
});


// =============================================
//  TTS — OpenAI first → Edge TTS fallback
// =============================================
async function tryEdgeTTS(cleanText, voiceId) {
  const edgeVoice = EDGE_VOICES[voiceId] || 'en-US-SaraNeural';
  console.log('🎤 TTS fallback (Edge):', edgeVoice, 'len=', cleanText.length);

  // Attempt 1: msedge-tts
  try {
    const { MsEdgeTTS } = require('msedge-tts');
    const tts = new MsEdgeTTS();
    await tts.setMetadata(edgeVoice, 'audio-24khz-48kbitrate-mono-mp3');
    const readable = tts.toStream(cleanText.substring(0, 2000));

    const chunks = [];
    await new Promise((resolve, reject) => {
      readable.on('data', c => chunks.push(c));
      readable.on('end', resolve);
      readable.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 20000);
    });

    const buffer = Buffer.concat(chunks);
    if (buffer.length > 100) {
      const fn = `tts-edge-${Date.now()}.mp3`;
      fs.writeFileSync(path.join(uploadDir, fn), buffer);
      console.log('✅ TTS Edge (msedge-tts):', `${Math.round(buffer.length / 1024)}KB`);
      return fn;
    }
  } catch (e) {
    console.log('⚠️ msedge-tts failed:', e.message);
  }

  // Attempt 2: edge-tts-node
  try {
    const EdgeTTS = require('edge-tts-node');
    const tts = new EdgeTTS();
    await tts.setVoice(edgeVoice);
    const fn = `tts-edge2-${Date.now()}.mp3`;
    const outPath = path.join(uploadDir, fn);
    await tts.ttsPromise(cleanText.substring(0, 2000), outPath);
    const stat = fs.statSync(outPath);
    if (stat.size > 100) {
      console.log('✅ TTS Edge (edge-tts-node):', `${Math.round(stat.size / 1024)}KB`);
      return fn;
    }
    fs.unlinkSync(outPath);
  } catch (e) {
    console.log('⚠️ edge-tts-node failed:', e.message);
  }

  return null;
}

router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const voiceId = TTS_VOICES[voice] || 'nova';
    const cleanText = cleanForTTS(text);
    const base = getBaseUrl(req);

    // ── PRIORITY 1: OpenAI TTS ──
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        console.log('🎤 TTS (OpenAI): voice=', voiceId, 'len=', cleanText.length);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: cleanText.substring(0, 4096),
            voice: voiceId,
            response_format: 'mp3',
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (ttsRes.ok) {
          const buffer = Buffer.from(await ttsRes.arrayBuffer());
          if (buffer.length > 100) {
            const fn = `tts-${Date.now()}.mp3`;
            fs.writeFileSync(path.join(uploadDir, fn), buffer);
            console.log('✅ TTS (OpenAI):', `${Math.round(buffer.length / 1024)}KB`);
            return res.json({ audio_url: `${base}/uploads/${fn}` });
          }
        }
        const errText = await ttsRes.text().catch(() => '');
        console.log(`⚠️ OpenAI TTS failed: ${ttsRes.status} — ${errText.substring(0, 200)}`);
      } catch (e) {
        console.log('⚠️ OpenAI TTS error:', e.message);
      }
    } else {
      console.log('⚠️ OpenAI TTS skipped: no key');
    }

    // ── PRIORITY 2: Edge TTS (free) ──
    const edgeFile = await tryEdgeTTS(cleanText, voiceId);
    if (edgeFile) {
      return res.json({ audio_url: `${base}/uploads/${edgeFile}` });
    }

    // ── PRIORITY 3: Browser TTS (last resort) ──
    console.log('⚠️ All TTS failed — browser fallback');
    return res.json({
      audio_url: null,
      useBrowserTTS: true,
      text: cleanText.substring(0, 4096),
      voiceHints: { gender: 'female', nameHints: ['samantha', 'sara', 'female'] },
    });

  } catch (e) {
    console.error('❌ TTS error:', e?.message);
    res.json({
      audio_url: null,
      useBrowserTTS: true,
      text: (req.body.text || '').substring(0, 4096),
      voiceHints: { gender: 'female', nameHints: ['samantha', 'sara', 'female'] },
    });
  }
});


// =============================================
//  Save voice message to DB
// =============================================
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { companionId, audioUrl, content, messageId, isUser } = req.body;
    if (!companionId) return res.status(400).json({ error: 'Missing companionId' });

    if (messageId) {
      const newType = isUser ? 'vn' : 'audio';
      await pool.query(
        `UPDATE messages SET type = $1, media_url = COALESCE($2, media_url) WHERE id = $3 AND user_id = $4`,
        [newType, audioUrl || null, messageId, req.user.id]
      );
    } else if (audioUrl) {
      const recent = await pool.query(
        `SELECT id FROM messages WHERE user_id = $1 AND companion_id = $2 AND role = 'assistant' AND type = 'text' ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, companionId]
      );
      if (recent.rows.length > 0) {
        await pool.query(`UPDATE messages SET type = 'audio', media_url = $1 WHERE id = $2`, [audioUrl, recent.rows[0].id]);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Save voice error:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});


// =============================================
//  Upload user voice note
// =============================================
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = file.mimetype?.includes('mp4') ? '.mp4' : file.mimetype?.includes('ogg') ? '.ogg' : '.webm';
      cb(null, `vn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('audio/') || file.mimetype?.startsWith('video/')) cb(null, true);
    else cb(new Error('Audio only'), false);
  },
});

router.post('/upload', authMiddleware, upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio' });
    const audioUrl = `${getBaseUrl(req)}/uploads/${req.file.filename}`;
    console.log('🎤 VN uploaded:', audioUrl, `(${Math.round(req.file.size / 1024)}KB)`);
    return res.json({ audio_url: audioUrl });
  } catch (e) {
    console.error('Upload error:', e.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
