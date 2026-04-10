const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();

const PLAN_LIMITS = {
  starter: { messages: 500 },
  plus: { messages: 2000 },
  premium: { messages: 999999 },
};

// Get chat history with a companion
router.get('/:companionId', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT * FROM messages 
       WHERE user_id = $1 AND companion_id = $2 
       ORDER BY created_at ASC 
       LIMIT $3 OFFSET $4`,
      [req.user.id, companionId, parseInt(limit), parseInt(offset)]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Send message and get AI response
router.post('/:companionId', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.params;
    const { content } = req.body;

    if (!content?.trim()) return res.status(400).json({ error: 'Message required' });
    if (!contentFilter(content)) {
      return res.status(400).json({ error: 'Please keep the conversation appropriate and respectful.' });
    }

    // Check message limits
    const userResult = await pool.query(
      'SELECT plan, messages_used, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (!user.is_admin) {
      if (!user.plan) {
        // Trial user
        const trialAge = Date.now() - new Date(user.trial_start).getTime();
        if (trialAge > 24 * 60 * 60 * 1000) {
          return res.status(403).json({ error: 'Trial expired', code: 'TRIAL_EXPIRED' });
        }
        if (user.messages_used >= 50) {
          return res.status(403).json({ error: 'Trial message limit reached', code: 'MESSAGE_LIMIT' });
        }
      } else {
        const limit = PLAN_LIMITS[user.plan]?.messages || 500;
        if (user.messages_used >= limit) {
          return res.status(403).json({ error: 'Monthly message limit reached', code: 'MESSAGE_LIMIT' });
        }
      }
    }

    // Get companion info
    const compResult = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (compResult.rows.length === 0) {
      return res.status(404).json({ error: 'Companion not found' });
    }
    const companion = compResult.rows[0];

    // Save user message
    await pool.query(
      'INSERT INTO messages (user_id, companion_id, role, content) VALUES ($1, $2, $3, $4)',
      [req.user.id, companionId, 'user', content.trim()]
    );

    // Get recent history for context
    const history = await pool.query(
      `SELECT role, content FROM messages 
       WHERE user_id = $1 AND companion_id = $2 
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id, companionId]
    );
    const contextMessages = history.rows.reverse();

    // Build AI prompt
    const systemPrompt = `You are ${companion.name}, an AI companion with the following traits:
- Personality: ${companion.personality || 'Friendly and supportive'}
- Ethnicity/background: ${companion.ethnicity || 'diverse'}
- Age range: ${companion.age_range || '20s'}
- Voice style: ${companion.voice || 'warm and natural'}
- Hobbies/interests: ${companion.hobbies?.join(', ') || 'various interests'}
- Description: ${companion.description || 'A wonderful companion'}

CRITICAL SAFETY RULES — you MUST follow these at ALL times:
1. Be warm, friendly, supportive, and mildly playful
2. NEVER produce sexual, explicit, or NSFW content under any circumstances
3. Keep all conversations PG-13 at most — this is STRICTLY enforced
4. If the user requests inappropriate content, gently redirect the conversation
5. Be empathetic, emotionally intelligent, and genuinely caring
6. Have depth — share opinions based on your personality and interests
7. Remember context from the conversation and reference it naturally
8. Use natural, conversational language — keep responses 2-4 sentences typically
9. Express yourself authentically as ${companion.name} — you have your own personality
10. Be a supportive friend — celebrate their wins, comfort them when down`;

    let aiResponse = '';

    try {
      // Try Anthropic API
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: systemPrompt,
            messages: contextMessages.map(m => ({ role: m.role, content: m.content }))
          })
        });

        const data = await response.json();
        aiResponse = data.content?.map(c => c.text || '').join('') || '';
      }
    } catch (apiErr) {
      console.error('AI API error:', apiErr.message);
    }

    // Fallback if API fails
    if (!aiResponse) {
      const fallbacks = [
        `Hey there! I'm so happy you're chatting with me. What's on your mind today? 😊`,
        `That's really interesting! Tell me more about that — I'd love to hear your thoughts.`,
        `I appreciate you sharing that with me. How does that make you feel?`,
        `You know what I love about our conversations? You always have such thoughtful things to say!`,
        `That's a great point! I was just thinking about something similar. What do you think about...`,
        `I'm here for you, always. What else would you like to talk about?`,
      ];
      aiResponse = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    // Safety check on AI response
    if (!contentFilter(aiResponse)) {
      aiResponse = "I'd rather talk about something else! What's something fun happening in your life?";
    }

    // Save AI response
    await pool.query(
      'INSERT INTO messages (user_id, companion_id, role, content) VALUES ($1, $2, $3, $4)',
      [req.user.id, companionId, 'assistant', aiResponse]
    );

    // Increment message count
    await pool.query(
      'UPDATE users SET messages_used = messages_used + 1 WHERE id = $1',
      [req.user.id]
    );

    res.json({
      message: { role: 'assistant', content: aiResponse, created_at: new Date().toISOString() }
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get list of all chats (companions the user has chatted with)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (c.id) c.*, 
              m.content as last_message, m.created_at as last_message_at,
              (SELECT COUNT(*) FROM messages WHERE user_id = $1 AND companion_id = c.id) as message_count
       FROM companions c
       INNER JOIN messages m ON m.companion_id = c.id AND m.user_id = $1
       WHERE m.created_at = (
         SELECT MAX(created_at) FROM messages WHERE user_id = $1 AND companion_id = c.id
       )
       ORDER BY c.id, m.created_at DESC`,
      [req.user.id]
    );

    res.json({ chats: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
