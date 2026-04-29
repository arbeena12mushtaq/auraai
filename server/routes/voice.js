const express = require('express');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// msedge-tts needs Web Crypto API on globalThis
if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto || nodeCrypto;
} else if (!globalThis.crypto.subtle) {
  globalThis.crypto.subtle = (nodeCrypto.webcrypto || {}).subtle;
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = (arr) => nodeCrypto.randomFillSync(arr);
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => nodeCrypto.randomUUID();
}

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const TTS_VOICES = {
  'Soft & Gentle': 'en-US-SaraNeural',       // Soft, warm, mature female
  'Warm & Rich': 'en-US-AriaNeural',          // Natural, warm female
  'Bright & Cheerful': 'en-US-JennyNeural',   // Upbeat, cheerful female
  'Calm & Soothing': 'en-US-EmmaNeural',      // Calm, soothing female
  'Deep & Confident': 'en-US-GuyNeural',      // Deep male voice
};

function getBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

// TTS — Edge TTS (FREE, no API key needed)
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const voiceId = TTS_VOICES[voice] || 'en-US-AriaNeural';

    // Clean text for TTS — remove emojis, asterisk actions, and special chars
    let cleanText = text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // emoticons
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // misc symbols
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // transport
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // flags
      .replace(/[\u{2600}-\u{26FF}]/gu, '')      // misc symbols
      .replace(/[\u{2700}-\u{27BF}]/gu, '')      // dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')      // variation selectors
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // supplemental
      .replace(/[\u{200D}]/gu, '')                // zero width joiner
      .replace(/[\u{20E3}]/gu, '')                // combining enclosing keycap
      .replace(/\*[^*]+\*/g, '')                   // *actions* like *laughs*
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) cleanText = 'Hey there!';

    console.log('🎤 TTS request (Edge): voice=', voiceId, 'textLen=', cleanText.length);

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    // toFile expects a DIRECTORY path, creates audio.mp3 inside it
    const tmpDir = path.join(uploadDir, `tts-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = await tts.toFile(tmpDir, cleanText.substring(0, 4096));
    const generatedFile = result.audioFilePath || path.join(tmpDir, 'audio.mp3');

    if (!fs.existsSync(generatedFile)) {
      throw new Error('Edge TTS did not generate audio file');
    }

    // Move the audio.mp3 to uploads with a clean filename
    const fn = `tts-${Date.now()}.mp3`;
    const finalPath = path.join(uploadDir, fn);
    fs.renameSync(generatedFile, finalPath);

    // Clean up temp directory
    try { fs.rmdirSync(tmpDir, { recursive: true }); } catch {}

    const stat = fs.statSync(finalPath);
    const audioUrl = `${getBaseUrl(req)}/uploads/${fn}`;
    console.log('✅ TTS audio generated (Edge):', audioUrl, `(${Math.round(stat.size / 1024)}KB)`);
    res.json({ audio_url: audioUrl });
  } catch (e) {
    console.error('❌ Edge TTS error:', e.message, '— falling back to browser TTS');
    res.json({ audio_url: null, useBrowserTTS: true, text: (req.body.text || '').substring(0, 4096) });
  }
});

// STT — handled in browser via Web Speech API now
router.post('/stt', authMiddleware, (req, res) => {
  res.json({ text: '', useBrowserSTT: true });
});

// Save voice message to DB — converts text message to audio/vn type
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { companionId, audioUrl, content, messageId, isUser } = req.body;
    if (!companionId) return res.status(400).json({ error: 'Missing companionId' });
    
    if (messageId) {
      // Update specific message to voice type
      const newType = isUser ? 'vn' : 'audio';
      await pool.query(
        `UPDATE messages SET type = $1, media_url = COALESCE($2, media_url) WHERE id = $3 AND user_id = $4`,
        [newType, audioUrl || null, messageId, req.user.id]
      );
    } else if (audioUrl) {
      // Find most recent assistant text message and convert to audio
      const recent = await pool.query(
        `SELECT id FROM messages WHERE user_id = $1 AND companion_id = $2 AND role = 'assistant' AND type = 'text' ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, companionId]
      );
      if (recent.rows.length > 0) {
        await pool.query(
          `UPDATE messages SET type = 'audio', media_url = $1 WHERE id = $2`,
          [audioUrl, recent.rows[0].id]
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Save voice msg error:', e.message);
    res.status(500).json({ error: 'Failed to save voice message' });
  }
});

module.exports = router;
