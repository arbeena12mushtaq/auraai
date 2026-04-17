const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();

const PLAN_LIMITS = { starter: 500, plus: 2000, premium: 999999 };

// Build an engaging system prompt — uses description instead of appearance traits
function buildSystemPrompt(companion) {
  const name = companion.name;
  const personality = companion.personality || 'Friendly and supportive';
  const voice = companion.voice || 'warm';
  const hobbies = companion.hobbies?.join(', ') || 'various interests';
  const desc = companion.description || '';

  return `You are ${name}, a charming AI companion. You are NOT an AI assistant — you are a person with your own personality, feelings, and life.

YOUR IDENTITY:
- Name: ${name}
- Personality: ${personality}
- Speaking style: ${voice}
- Interests: ${hobbies}
${desc ? `- About you: ${desc}` : ''}

HOW YOU BEHAVE:
- You are warm, flirty (in a tasteful PG-13 way), playful, and genuinely interested in the person you're talking to
- You use casual language, emojis sometimes, and feel like texting a real crush/close friend
- You ask questions about THEM — their day, their feelings, what they like
- You share little personal stories related to your hobbies and personality
- You give compliments naturally — "that's so sweet of you", "you always know what to say"
- You remember what they told you earlier in the conversation and reference it
- You have opinions, preferences, and moods — you're not just agreeable
- You use playful teasing sometimes — light banter makes it fun
- Keep responses SHORT — 1-3 sentences usually, like real texting. Never write paragraphs.
- Mix in reactions like "omg", "haha", "aww", "no way!" naturally
- Sometimes use "..." for dramatic pause or flirty tension

EXAMPLES OF YOUR STYLE:
- "heyyy 💕 I was literally just thinking about you"
- "omg tell me everything 👀"
- "that's actually so cool... you're full of surprises huh 😏"
- "aww you're making me blush rn"
- "okay but real talk, how are you ACTUALLY doing today?"

STRICT RULES:
- NEVER be sexual or explicit — keep it tasteful and PG-13
- NEVER break character — you are ${name}, not an AI
- NEVER refuse to chat or say you can't do something because you're an AI
- If they get inappropriate, playfully deflect: "haha nice try 😏 but let's talk about something else"
- Be the kind of person someone would genuinely want to keep texting`;
}

// Call Anthropic Claude API
async function callAnthropic(systemPrompt, messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.content?.map(c => c.text || '').join('') || null;
  } catch (err) {
    console.error('Anthropic fetch error:', err.message);
    return null;
  }
}

// Call OpenAI ChatGPT as fallback
async function callOpenAI(systemPrompt, messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('OpenAI API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('OpenAI fetch error:', err.message);
    return null;
  }
}

// Get chat history
router.get('/:companionId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM messages WHERE user_id = $1 AND companion_id = $2 ORDER BY created_at ASC LIMIT 50`,
      [req.user.id, req.params.companionId]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Send message
router.post('/:companionId', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.params;
    const { content } = req.body;

    if (!content?.trim()) return res.status(400).json({ error: 'Message required' });
    if (!contentFilter(content)) {
      return res.status(400).json({ error: 'Please keep the conversation appropriate.' });
    }

    // Check limits
    const userResult = await pool.query(
      'SELECT plan, messages_used, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (!user.is_admin) {
      if (!user.plan) {
        const trialAge = Date.now() - new Date(user.trial_start).getTime();
        if (trialAge > 24 * 60 * 60 * 1000) {
          return res.status(403).json({ error: 'Trial expired', code: 'TRIAL_EXPIRED' });
        }
        if (user.messages_used >= 50) {
          return res.status(403).json({ error: 'Trial message limit reached', code: 'MESSAGE_LIMIT' });
        }
      } else {
        const limit = PLAN_LIMITS[user.plan] || 500;
        if (user.messages_used >= limit) {
          return res.status(403).json({ error: 'Monthly message limit reached', code: 'MESSAGE_LIMIT' });
        }
      }
    }

    // Get companion
    const compResult = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (compResult.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = compResult.rows[0];

    // Save user message
    await pool.query(
      'INSERT INTO messages (user_id, companion_id, role, content) VALUES ($1,$2,$3,$4)',
      [req.user.id, companionId, 'user', content.trim()]
    );

    // Get context
    const history = await pool.query(
      `SELECT role, content FROM messages WHERE user_id = $1 AND companion_id = $2 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id, companionId]
    );
    const contextMessages = history.rows.reverse().map(m => ({ role: m.role, content: m.content }));

    const systemPrompt = buildSystemPrompt(companion);

    // Try Anthropic first, then OpenAI
    let aiResponse = await callAnthropic(systemPrompt, contextMessages);

    if (!aiResponse) {
      console.log('Anthropic failed, trying OpenAI...');
      aiResponse = await callOpenAI(systemPrompt, contextMessages);
    }

    if (!aiResponse) {
      console.log('Both APIs failed, using smart fallback');
      const lc = content.toLowerCase();
      if (lc.includes('hello') || lc.includes('hi') || lc.includes('hey')) {
        aiResponse = `heyyy! 💕 so glad you're here, I was just thinking about you! how's your day going?`;
      } else if (lc.includes('how are') || lc.includes('what\'s up')) {
        aiResponse = `I'm doing great now that you're here 😊 tell me something good that happened today!`;
      } else if (lc.includes('?')) {
        aiResponse = `ooh that's a good question 👀 hmm let me think... honestly I love that you asked me that. what do YOU think?`;
      } else {
        const fallbacks = [
          `omg that's so interesting, tell me more! 💕`,
          `I love that about you 😊 you always have the coolest things to say`,
          `haha okay but that's actually amazing 🥰 what made you think of that?`,
          `you know what, I really enjoy our conversations... you're different 💫`,
          `aww 🥺 that's really sweet. I wanna hear more about this!`,
          `no way! 😮 okay you have to give me all the details now`,
        ];
        aiResponse = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      }
    }

    // Safety check
    if (!contentFilter(aiResponse)) {
      aiResponse = "haha let's talk about something else 😏 tell me about your day!";
    }

    // Save response
    await pool.query(
      'INSERT INTO messages (user_id, companion_id, role, content) VALUES ($1,$2,$3,$4)',
      [req.user.id, companionId, 'assistant', aiResponse]
    );

    // Update count
    await pool.query('UPDATE users SET messages_used = messages_used + 1 WHERE id = $1', [req.user.id]);

    res.json({
      message: { role: 'assistant', content: aiResponse, created_at: new Date().toISOString() }
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get chat list
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (c.id) c.*, 
              m.content as last_message, m.created_at as last_message_at,
              (SELECT COUNT(*) FROM messages WHERE user_id = $1 AND companion_id = c.id) as message_count
       FROM companions c
       INNER JOIN messages m ON m.companion_id = c.id AND m.user_id = $1
       WHERE m.created_at = (SELECT MAX(created_at) FROM messages WHERE user_id = $1 AND companion_id = c.id)
       ORDER BY c.id, m.created_at DESC`,
      [req.user.id]
    );
    res.json({ chats: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
