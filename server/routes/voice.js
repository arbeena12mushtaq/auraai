const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ==================== OPENAI TEXT-TO-SPEECH ====================
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'OpenAI API key not configured' });

    // Map companion voice to OpenAI voice
    const voiceMap = {
      'Soft & Gentle': 'nova',
      'Warm & Rich': 'shimmer',
      'Bright & Cheerful': 'alloy',
      'Calm & Soothing': 'echo',
      'Deep & Confident': 'onyx',
    };
    const ttsVoice = voiceMap[voice] || 'nova';

    console.log(`🎤 TTS: "${text.substring(0, 50)}..." → voice: ${ttsVoice}`);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.substring(0, 4096),
        voice: ttsVoice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('TTS error:', response.status, err);
      return res.status(500).json({ error: 'Voice generation failed' });
    }

    const buffer = await response.arrayBuffer();
    const filename = `tts-${Date.now()}.mp3`;
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, Buffer.from(buffer));

    console.log(`✅ TTS saved: ${filename} (${Math.round(buffer.byteLength / 1024)}KB)`);
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
    if (!didKey) {
      return res.status(400).json({ error: 'D-ID API key not configured', fallback: 'tts' });
    }

    // Map voice
    const voiceMap = {
      'Soft & Gentle': { provider: 'microsoft', voice_id: 'en-US-JennyNeural' },
      'Warm & Rich': { provider: 'microsoft', voice_id: 'en-US-AriaNeural' },
      'Bright & Cheerful': { provider: 'microsoft', voice_id: 'en-US-SaraNeural' },
      'Calm & Soothing': { provider: 'microsoft', voice_id: 'en-US-JaneNeural' },
      'Deep & Confident': { provider: 'microsoft', voice_id: 'en-US-GuyNeural' },
    };
    const selectedVoice = voiceMap[voice] || voiceMap['Soft & Gentle'];

    // Determine source image
    let sourceUrl = image_url;
    if (sourceUrl && sourceUrl.startsWith('/uploads/')) {
      // Convert local path to full URL
      const baseUrl = process.env.CLIENT_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3001'}`;
      sourceUrl = `${baseUrl}${sourceUrl}`;
    }
    // Fallback to a default portrait if no image
    if (!sourceUrl || sourceUrl.includes('pravatar')) {
      sourceUrl = 'https://i.pravatar.cc/400?img=1';
    }

    console.log(`🎬 D-ID: Creating talking avatar...`);
    console.log(`   Image: ${sourceUrl}`);
    console.log(`   Text: "${text.substring(0, 60)}..."`);

    // Create D-ID talk video
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
          input: text.substring(0, 1000),
          provider: selectedVoice,
        },
        config: {
          fluent: true,
          pad_audio: 0.5,
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.error('D-ID create error:', createRes.status, err);
      return res.status(500).json({ error: 'Avatar video creation failed', fallback: 'tts' });
    }

    const createData = await createRes.json();
    const talkId = createData.id;
    console.log(`   Talk ID: ${talkId}`);

    // Poll for completion (D-ID processes async)
    let videoUrl = null;
    let attempts = 0;
    while (attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;

      const statusRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
        headers: { 'Authorization': `Basic ${didKey}` },
      });

      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();

      if (statusData.status === 'done') {
        videoUrl = statusData.result_url;
        break;
      } else if (statusData.status === 'error') {
        console.error('D-ID processing error:', statusData.error);
        break;
      }
    }

    if (!videoUrl) {
      return res.status(500).json({ error: 'Avatar video generation timed out', fallback: 'tts' });
    }

    console.log(`✅ D-ID video ready: ${videoUrl}`);
    res.json({ video_url: videoUrl, talk_id: talkId });
  } catch (err) {
    console.error('D-ID error:', err.message);
    res.status(500).json({ error: 'Avatar video failed', fallback: 'tts' });
  }
});

module.exports = router;
