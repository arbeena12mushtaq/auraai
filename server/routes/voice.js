const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Map companion voice to OpenAI TTS voice
const TTS_VOICES = {
  'Soft & Gentle': 'nova',
  'Warm & Rich': 'shimmer',
  'Bright & Cheerful': 'alloy',
  'Calm & Soothing': 'echo',
  'Deep & Confident': 'onyx',
};

// Map companion voice to D-ID voice (must use their supported voices)
const DID_VOICES = {
  'Soft & Gentle': { type: 'microsoft', voice_id: 'Sara' },
  'Warm & Rich': { type: 'microsoft', voice_id: 'Aria' },
  'Bright & Cheerful': { type: 'microsoft', voice_id: 'Jenny' },
  'Calm & Soothing': { type: 'microsoft', voice_id: 'Emma' },
  'Deep & Confident': { type: 'amazon', voice_id: 'Matthew' },
};

// ==================== TEXT TO SPEECH ====================
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Voice not available' });

    const ttsVoice = TTS_VOICES[voice] || 'nova';
    console.log(`🎤 TTS: "${text.substring(0, 50)}..." → ${ttsVoice}`);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.substring(0, 4096),
        voice: ttsVoice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      console.error('TTS error:', response.status, await response.text());
      return res.status(500).json({ error: 'Voice generation failed' });
    }

    const buffer = await response.arrayBuffer();
    const filename = `tts-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(buffer));
    console.log(`✅ TTS: ${filename} (${Math.round(buffer.byteLength / 1024)}KB)`);

    res.json({ audio_url: `/uploads/${filename}` });
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: 'Voice generation failed' });
  }
});

// ==================== D-ID TALKING AVATAR ====================
router.post('/talking-avatar', authMiddleware, async (req, res) => {
  try {
    const { text, image_url, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const didKey = process.env.DID_API_KEY;
    if (!didKey) return res.status(400).json({ error: 'D-ID not configured', fallback: 'tts' });

    // Build source URL
    let sourceUrl = image_url;
    if (sourceUrl && sourceUrl.startsWith('/uploads/')) {
      const host = process.env.CLIENT_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
      if (host) {
        sourceUrl = host.startsWith('http') ? `${host}${sourceUrl}` : `https://${host}${sourceUrl}`;
      }
    }
    if (!sourceUrl || sourceUrl.includes('pravatar')) {
      sourceUrl = 'https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/image.jpeg';
    }

    const didVoice = DID_VOICES[voice] || DID_VOICES['Soft & Gentle'];

    console.log(`🎬 D-ID: image=${sourceUrl.substring(0, 60)}...`);

    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${didKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: sourceUrl,
        script: {
          type: 'text',
          input: text.substring(0, 500),
          provider: {
            type: didVoice.type,
            voice_id: didVoice.voice_id,
          },
        },
        config: { fluent: true },
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error('D-ID create error:', createRes.status, errBody);
      return res.status(500).json({ error: 'Avatar failed', fallback: 'tts' });
    }

    const { id: talkId } = await createRes.json();
    console.log(`   Talk ID: ${talkId} — polling...`);

    // Poll for result
    let videoUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
        headers: { 'Authorization': `Basic ${didKey}` },
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      if (pollData.status === 'done') { videoUrl = pollData.result_url; break; }
      if (pollData.status === 'error') { console.error('D-ID error:', pollData.error); break; }
    }

    if (!videoUrl) return res.status(500).json({ error: 'Avatar timed out', fallback: 'tts' });

    console.log(`✅ D-ID video ready`);
    res.json({ video_url: videoUrl });
  } catch (err) {
    console.error('D-ID error:', err.message);
    res.status(500).json({ error: 'Avatar failed', fallback: 'tts' });
  }
});

// ==================== SPEECH TO TEXT (for voice notes from user) ====================
router.post('/stt', authMiddleware, async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Not available' });

    // Expect base64 audio from frontend
    const { audio_data } = req.body;
    if (!audio_data) return res.status(400).json({ error: 'No audio data' });

    // Save temp file
    const buffer = Buffer.from(audio_data, 'base64');
    const tempFile = path.join(uploadDir, `stt-${Date.now()}.webm`);
    fs.writeFileSync(tempFile, buffer);

    // Call OpenAI Whisper
    const FormData = (await import('node-fetch')).default ? null : null;
    const formData = new (require('form-data'))();
    formData.append('file', fs.createReadStream(tempFile), { filename: 'audio.webm', contentType: 'audio/webm' });
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
      body: formData,
    });

    // Clean up temp
    try { fs.unlinkSync(tempFile); } catch {}

    if (!response.ok) {
      console.error('STT error:', response.status);
      return res.status(500).json({ error: 'Transcription failed' });
    }

    const data = await response.json();
    console.log(`🎙️ STT: "${data.text?.substring(0, 60)}..."`);
    res.json({ text: data.text });
  } catch (err) {
    console.error('STT error:', err.message);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

module.exports = router;
