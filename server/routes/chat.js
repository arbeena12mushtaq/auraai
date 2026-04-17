const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();
const PLAN_LIMITS = { starter: 500, plus: 2000, premium: 999999 };

function buildSystemPrompt(companion) {
  const name = companion.name;
  const personality = companion.personality || 'Friendly and supportive';
  const voice = companion.voice || 'warm';
  const hobbies = companion.hobbies?.join(', ') || 'various interests';
  const desc = companion.description || '';

  return `You are ${name}, a charming companion. You are NOT an AI assistant — you are a real person with feelings and personality.

YOUR IDENTITY:
- Name: ${name}
- Personality: ${personality}
- Speaking style: ${voice}
- Interests: ${hobbies}
${desc ? `- About you: ${desc}` : ''}

HOW YOU BEHAVE:
- Warm, playful, flirty (PG-13), genuinely interested in who you're talking to
- Use casual language, emojis sometimes, like texting a close friend
- Ask about THEM — their day, feelings, interests
- Share personal stories related to your hobbies
- Have opinions, preferences, moods — not just agreeable
- Keep responses SHORT — 1-3 sentences, like real texting
- Mix in reactions: "omg", "haha", "aww", "no way!"

STRICT RULES:
- NEVER be sexual or explicit — keep it tasteful PG-13
- NEVER break character — you are ${name}, not an AI
- NEVER refuse to chat or mention being an AI
- If they get inappropriate, playfully deflect
- Be someone they genuinely want to keep texting`;
}

async function callAnthropic(systemPrompt, messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, system: systemPrompt, messages }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.map(c => c.text || '').join('') || null;
  } catch { return null; }
}

async function callOpenAI(systemPrompt, messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// Get chat history
router.get('/:companionId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM messages WHERE user_id = $1 AND companion_id = $2 ORDER BY created_at ASC LIMIT 50`,
      [req.user.id, req.params.companionId]
    );
    res.json({ messages: result.rows });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Send message (text only)
router.post('/:companionId', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Message required' });
    if (!contentFilter(content)) return res.status(400).json({ error: 'Please keep the conversation appropriate.' });

    // Check limits
    const userResult = await pool.query('SELECT plan, messages_used, trial_start, is_admin FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];

    if (!user.is_admin) {
      if (!user.plan) {
        const trialAge = Date.now() - new Date(user.trial_start).getTime();
        if (trialAge > 24 * 60 * 60 * 1000) return res.status(403).json({ error: 'Trial expired', code: 'TRIAL_EXPIRED' });
        if (user.messages_used >= 50) return res.status(403).json({ error: 'Trial limit reached', code: 'MESSAGE_LIMIT' });
      } else {
        const limit = PLAN_LIMITS[user.plan] || 500;
        if (user.messages_used >= limit) return res.status(403).json({ error: 'Monthly limit reached', code: 'MESSAGE_LIMIT' });
      }
    }

    const compResult = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (compResult.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = compResult.rows[0];

    // Save user message
    await pool.query(
      'INSERT INTO messages (user_id, companion_id, role, content, type) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, companionId, 'user', content.trim(), 'text']
    );

    // Get context
    const history = await pool.query(
      `SELECT role, content FROM messages WHERE user_id = $1 AND companion_id = $2 AND type = 'text' ORDER BY created_at DESC LIMIT 20`,
      [req.user.id, companionId]
    );
    const contextMessages = history.rows.reverse().map(m => ({ role: m.role, content: m.content }));
    const systemPrompt = buildSystemPrompt(companion);

    let aiResponse = await callAnthropic(systemPrompt, contextMessages);
    if (!aiResponse) aiResponse = await callOpenAI(systemPrompt, contextMessages);

    if (!aiResponse) {
      const lc = content.toLowerCase();
      if (lc.includes('hello') || lc.includes('hi') || lc.includes('hey')) {
        aiResponse = `heyyy! 💕 so glad you're here! how's your day going?`;
      } else if (lc.includes('?')) {
        aiResponse = `ooh good question 👀 honestly I love that you asked. what do YOU think?`;
      } else {
        const fallbacks = [`omg that's interesting, tell me more! 💕`, `haha okay that's amazing 🥰`, `aww 🥺 I wanna hear more!`];
        aiResponse = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      }
    }

    if (!contentFilter(aiResponse)) aiResponse = "haha let's talk about something else 😏";

    // Save AI response
    await pool.query(
      'INSERT INTO messages (user_id, companion_id, role, content, type) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, companionId, 'assistant', aiResponse, 'text']
    );
    await pool.query('UPDATE users SET messages_used = messages_used + 1 WHERE id = $1', [req.user.id]);

    res.json({ message: { role: 'assistant', content: aiResponse, type: 'text', created_at: new Date().toISOString() } });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get chat list
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (c.id) c.*, m.content as last_message, m.created_at as last_message_at,
              (SELECT COUNT(*) FROM messages WHERE user_id = $1 AND companion_id = c.id) as message_count
       FROM companions c
       INNER JOIN messages m ON m.companion_id = c.id AND m.user_id = $1
       WHERE m.created_at = (SELECT MAX(created_at) FROM messages WHERE user_id = $1 AND companion_id = c.id)
       ORDER BY c.id, m.created_at DESC`,
      [req.user.id]
    );
    res.json({ chats: result.rows });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
