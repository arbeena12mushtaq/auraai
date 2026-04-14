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

// ===== Simli Auto: Create session for a companion =====
router.post('/simli-start', authMiddleware, async (req, res) => {
  try {
    const simliKey = process.env.SIMLI_API_KEY;
    if (!simliKey) return res.json({ available: false, error: 'SIMLI_API_KEY not set' });

    const { companionId, faceId } = req.body;

    // Get companion info for system prompt
    let systemPrompt = 'You are a friendly AI companion. Be warm, playful, and engaging. Keep responses short (1-3 sentences).';
    if (companionId) {
      const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
      if (comp.rows.length > 0) {
        const c = comp.rows[0];
        systemPrompt = `You are ${c.name}. Personality: ${c.personality||'friendly'}. Be warm, flirty (PG-13), playful, and engaging. Use emojis. Keep responses to 1-3 short sentences like texting. Never say you're an AI.`;
      }
    }

    // Build the custom LLM config pointing to Anthropic via OpenAI-compatible proxy
    // OR use OpenAI directly since Simli supports it natively
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    const sessionBody = {
      apiKey: simliKey,
      faceId: faceId || '5514e24d-6086-46a3-ace4-6a7264e5cb7c',
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

    console.log('🎬 Starting Simli Auto session...');
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
// Simli Auto can point to YOUR server as the LLM backend
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
        // Stream OpenAI-compatible format
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
