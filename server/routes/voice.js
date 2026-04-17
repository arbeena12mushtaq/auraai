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

const TTS_VOICES = { 'Soft & Gentle':'nova','Warm & Rich':'shimmer','Bright & Cheerful':'alloy','Calm & Soothing':'echo','Deep & Confident':'onyx' };

// ===== TTS =====
router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const k = process.env.OPENAI_API_KEY;
    if (!k) return res.status(400).json({ error: 'Not configured' });
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method:'POST', headers:{'Authorization':`Bearer ${k}`,'Content-Type':'application/json'},
      body: JSON.stringify({model:'tts-1',input:text.substring(0,4096),voice:TTS_VOICES[voice]||'nova',response_format:'mp3'}),
    });
    if (!r.ok) return res.status(500).json({ error: 'TTS failed' });
    const buf = Buffer.from(await r.arrayBuffer());
    const fn = `tts-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(uploadDir,fn), buf);
    res.json({ audio_url: `/uploads/${fn}` });
  } catch { res.status(500).json({ error: 'TTS failed' }); }
});

// ===== STT =====
router.post('/stt', authMiddleware, audioUpload.single('audio'), async (req, res) => {
  let tp = null;
  try {
    const k = process.env.OPENAI_API_KEY;
    if (!k||!req.file) return res.status(400).json({ error: 'Not configured' });
    tp = req.file.path; const np = tp+'.webm'; fs.renameSync(tp,np); tp = np;
    const fb = fs.readFileSync(tp);
    const fd = new FormData();
    fd.append('file', new Blob([fb],{type:'audio/webm'}), 'voice.webm');
    fd.append('model','whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {method:'POST',headers:{'Authorization':`Bearer ${k}`},body:fd});
    if (!r.ok) return res.status(500).json({ error: 'STT failed' });
    const d = await r.json();
    res.json({ text: d.text||'' });
  } catch { res.status(500).json({ error: 'STT failed' }); }
  finally { if (tp) try{fs.unlinkSync(tp)}catch{} }
});

// ===== Video Message: Generate a short video clip of the avatar speaking =====
// Uses Simli's API to create a video from avatar image + audio
router.post('/video-message', authMiddleware, async (req, res) => {
  try {
    const { text, voice, companionId, avatarUrl } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const simliKey = process.env.SIMLI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Step 1: Generate audio via TTS
    let audioBuffer = null;
    if (openaiKey) {
      try {
        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'tts-1',
            input: text.substring(0, 4096),
            voice: TTS_VOICES[voice] || 'nova',
            response_format: 'mp3',
          }),
        });
        if (ttsRes.ok) {
          audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        }
      } catch (e) {
        console.error('TTS for video failed:', e.message);
      }
    }

    // If no audio, can't make video — fallback to audio-only
    if (!audioBuffer) {
      return res.json({ video_url: null, audio_url: null, error: 'TTS unavailable' });
    }

    // Save audio file regardless (used as fallback)
    const audioFn = `tts-${Date.now()}.mp3`;
    const audioPath = path.join(uploadDir, audioFn);
    fs.writeFileSync(audioPath, audioBuffer);
    const audioUrl = `/uploads/${audioFn}`;

    // Step 2: If Simli is available, try to generate video with avatar
    if (simliKey && avatarUrl) {
      try {
        // Resolve avatar URL to a full public URL for Simli
        let fullAvatarUrl = avatarUrl;
        if (avatarUrl.startsWith('/uploads/')) {
          // It's a local path — Simli needs a public URL
          // We'll use the Simli faceId approach instead, or skip if not publicly accessible
          // For now, use default Simli face and fall back
          console.log('⚠️ Avatar is local, Simli needs a public URL. Using default face.');
        }

        // Try Simli's lip-sync / video generation API
        // Simli Auto creates a real-time session. For async video messages,
        // we use Simli's "create video" API if available, otherwise fall back to audio.

        // Attempt: Use Simli's async video generation endpoint
        const simliRes = await fetch('https://api.simli.ai/textToVideoStream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-simli-api-key': simliKey,
          },
          body: JSON.stringify({
            ttsAPIKey: openaiKey,
            simliAPIKey: simliKey,
            faceId: null, // Will be set below
            requestBody: {
              model: 'tts-1',
              input: text.substring(0, 500),
              voice: TTS_VOICES[voice] || 'nova',
            },
          }),
        });

        if (simliRes.ok) {
          const contentType = simliRes.headers.get('content-type') || '';
          if (contentType.includes('video') || contentType.includes('octet-stream')) {
            const videoBuffer = Buffer.from(await simliRes.arrayBuffer());
            const videoFn = `video-${Date.now()}.mp4`;
            const videoPath = path.join(uploadDir, videoFn);
            fs.writeFileSync(videoPath, videoBuffer);
            console.log(`✅ Simli video message saved: ${videoFn}`);
            return res.json({ video_url: `/uploads/${videoFn}`, audio_url: audioUrl });
          } else {
            const simliData = await simliRes.json();
            if (simliData.url || simliData.video_url) {
              return res.json({ video_url: simliData.url || simliData.video_url, audio_url: audioUrl });
            }
          }
        } else {
          const errText = await simliRes.text();
          console.error('Simli video-message error:', simliRes.status, errText.substring(0, 200));
        }
      } catch (e) {
        console.error('Simli video generation error:', e.message);
      }
    }

    // Fallback: return audio only (client will show it as voice note)
    console.log('📎 Video unavailable, falling back to audio');
    res.json({ video_url: null, audio_url: audioUrl });
  } catch (e) {
    console.error('Video message error:', e.message);
    res.status(500).json({ error: 'Video message failed' });
  }
});

// ===== Simli Auto: Start live video call session =====
router.post('/simli-start', authMiddleware, async (req, res) => {
  try {
    const simliKey = process.env.SIMLI_API_KEY;
    if (!simliKey) return res.json({ available: false, error: 'SIMLI_API_KEY not set' });

    const { companionId, avatarUrl } = req.body;

    // Get companion info for system prompt
    let systemPrompt = 'You are a friendly AI companion. Be warm, playful, and engaging. Keep responses short (1-3 sentences).';
    let faceId = '5514e24d-6086-46a3-ace4-6a7264e5cb7c'; // Default Simli face

    if (companionId) {
      const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
      if (comp.rows.length > 0) {
        const c = comp.rows[0];
        systemPrompt = `You are ${c.name}. Personality: ${c.personality||'friendly'}. Be warm, flirty (PG-13), playful, and engaging. Use emojis. Keep responses to 1-3 short sentences like texting. Never say you're an AI.`;

        // If companion has an avatar, try to create a Simli face from it
        // Simli allows creating custom faces from images
        if (c.avatar_url || avatarUrl) {
          const compAvatarUrl = avatarUrl || c.avatar_url;
          try {
            // Try to create a custom face in Simli from the avatar image
            const createFaceRes = await fetch('https://api.simli.ai/faces', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-simli-api-key': simliKey,
              },
              body: JSON.stringify({
                imageUrl: compAvatarUrl,
                name: c.name || 'companion',
              }),
            });

            if (createFaceRes.ok) {
              const faceData = await createFaceRes.json();
              if (faceData.faceId || faceData.id) {
                faceId = faceData.faceId || faceData.id;
                console.log(`✅ Created Simli face for ${c.name}: ${faceId}`);
              }
            } else {
              console.log('⚠️ Could not create Simli face from avatar, using default');
            }
          } catch (e) {
            console.log('⚠️ Simli face creation failed:', e.message);
          }
        }
      }
    }

    const openaiKey = process.env.OPENAI_API_KEY;

    const sessionBody = {
      apiKey: simliKey,
      faceId: faceId,
      ttsProvider: 'ElevenLabs',
      language: 'en',
      createTranscript: false,
      systemPrompt: systemPrompt,
      firstMessage: `hey there! 💕 I'm so glad you're here`,
      maxSessionLength: 300,
      maxIdleTime: 60,
    };

    // If we have OpenAI key, use it as custom LLM
    if (openaiKey) {
      sessionBody.customLLMConfig = {
        model: 'gpt-4o-mini',
        baseURL: 'https://api.openai.com/v1',
        llmAPIKey: openaiKey,
      };
    }

    console.log('🎬 Starting Simli Auto session with faceId:', faceId);
    const r = await fetch('https://api.simli.ai/auto/start/configurable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionBody),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('Simli start error:', r.status, err);
      return res.json({ available: false, error: 'Session failed: ' + err.substring(0,200) });
    }

    const data = await r.json();
    console.log('✅ Simli session:', JSON.stringify(data).substring(0, 200));
    res.json({ available: true, ...data });
  } catch (e) {
    console.error('Simli error:', e.message);
    res.json({ available: false, error: e.message });
  }
});

// ===== Check Simli availability =====
router.get('/simli-config', authMiddleware, (req, res) => {
  res.json({ available: !!process.env.SIMLI_API_KEY });
});

// ===== OpenAI-compatible endpoint for Simli to call as custom LLM =====
router.post('/llm/chat/completions', async (req, res) => {
  try {
    const { messages, model } = req.body;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Forward to Anthropic
    if (anthropicKey) {
      const sysMsg = messages.find(m => m.role === 'system')?.content || '';
      const chatMsgs = messages.filter(m => m.role !== 'system');

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-api-key':anthropicKey, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:200, system:sysMsg, messages:chatMsgs, stream:true }),
      });

      if (r.ok) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  const chunk = {
                    id: 'chatcmpl-' + Date.now(),
                    choices: [{ delta: { content: parsed.delta.text }, index: 0 }],
                    model: 'claude-sonnet', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000),
                  };
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
              } catch {}
            }
          }
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    // Fallback to OpenAI
    if (openaiKey) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...req.body, stream: true }),
      });
      if (r.ok) {
        res.setHeader('Content-Type', 'text/event-stream');
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value));
        }
        res.end();
        return;
      }
    }

    // Last resort
    res.setHeader('Content-Type', 'text/event-stream');
    const chunk = { id:'0', choices:[{delta:{content:"hey! how can I help you today? 💕"},index:0}], model:'fallback', object:'chat.completion.chunk', created:Math.floor(Date.now()/1000) };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('LLM proxy error:', e.message);
    res.status(500).json({ error: 'LLM failed' });
  }
});

module.exports = router;
