const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// msedge-tts needs global crypto
if (!globalThis.crypto) globalThis.crypto = crypto;
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = () => crypto.randomUUID();

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const TTS_VOICES = {
  'Soft & Gentle': 'en-US-AnaNeural',
  'Warm & Rich': 'en-US-AriaNeural',
  'Bright & Cheerful': 'en-US-JennyNeural',
  'Calm & Soothing': 'en-US-SaraNeural',
  'Deep & Confident': 'en-US-GuyNeural',
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
    console.log('🎤 TTS request (Edge): voice=', voiceId, 'textLen=', text.length);

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const fn = `tts-${Date.now()}.mp3`;
    const filePath = path.join(uploadDir, fn);

    // toFile writes the audio directly to disk — simpler and more reliable than toStream
    const result = await tts.toFile(filePath, text.substring(0, 4096));
    
    const stat = fs.statSync(filePath);
    if (stat.size < 100) {
      fs.unlinkSync(filePath);
      console.error('❌ Edge TTS: file too small, likely empty');
      return res.json({ audio_url: null, useBrowserTTS: true, text: text.substring(0, 4096) });
    }

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

// Save voice message to DB
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { companionId, audioUrl, content, messageId } = req.body;
    if (!companionId || !audioUrl) return res.status(400).json({ error: 'Missing fields' });

    if (messageId) {
      await pool.query(
        `UPDATE messages SET type = 'audio', media_url = $1 WHERE id = $2 AND user_id = $3`,
        [audioUrl, messageId, req.user.id]
      );
    } else {
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
