/**
 * GENERATE PRESET AVATARS
 * 
 * Run this ONCE on your server to generate AI images for all preset companions.
 * Usage: OPENAI_API_KEY=sk-xxx DATABASE_URL=postgres://... node generate-presets.js
 * 
 * Or run it on Railway:
 *   1. Go to your auraai service
 *   2. Click "Settings" → "Run Command" 
 *   3. Enter: node server/generate-presets.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const uploadDir = path.join(__dirname, 'server', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Also try relative path for when run from server directory
const uploadDir2 = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir2)) fs.mkdirSync(uploadDir2, { recursive: true });

const finalUploadDir = fs.existsSync(path.join(__dirname, 'server')) ? uploadDir : uploadDir2;

async function generateImage(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'hd',
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DALL-E error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

// Safe prompts that pass DALL-E content policy
const PRESET_PROMPTS = [
  // Girls - Realistic
  { name: 'Aria', prompt: 'Professional fashion photography headshot of a young woman with blonde wavy hair, blue eyes, warm genuine smile, wearing a cream knit sweater, soft golden hour lighting, shallow depth of field, magazine quality portrait' },
  { name: 'Luna', prompt: 'Professional portrait photograph of a confident young Latina woman with long dark hair, brown eyes, wearing a stylish leather jacket, urban city background blurred, warm tones, editorial fashion photography style' },
  { name: 'Emilia', prompt: 'Professional portrait of a young woman with red curly hair, green eyes, playful confident expression, wearing a casual white blouse, natural outdoor lighting, garden background blurred, warm color palette, high fashion photography' },
  { name: 'Zara', prompt: 'Professional portrait photograph of a confident young Black woman with natural curly hair, brown eyes, radiant smile, wearing a vibrant yellow top, studio lighting, clean background, fashion editorial style' },
  { name: 'Mei', prompt: 'Professional portrait of a gentle young East Asian woman with straight brown hair, hazel eyes, soft warm smile, wearing a light blue cardigan, cafe background blurred, natural window lighting, magazine photography' },
  { name: 'Sofia', prompt: 'Professional portrait of a young Latina woman with wavy brown hair, brown eyes, thoughtful serene expression, wearing an earth-tone dress, golden hour outdoor lighting, nature background blurred, editorial quality' },
  { name: 'Nadia', prompt: 'Professional portrait of a young Middle Eastern woman with long dark hair, hazel eyes, mysterious confident smile, wearing elegant dark clothing, dramatic studio lighting, dark background, high fashion editorial' },
  { name: 'Elena', prompt: 'Professional portrait of a young woman with straight blonde hair, blue eyes, energetic bright smile, wearing athletic casual wear, bright natural outdoor lighting, park background, lifestyle photography style' },
  { name: 'Isabella', prompt: 'Professional portrait of a young Latina woman with wavy dark hair, brown eyes, warm sweet expression, wearing a floral summer dress, warm sunset lighting, outdoor setting, romantic photography style' },
  { name: 'Aisha', prompt: 'Professional portrait of a young Black woman with curly natural hair, brown eyes, wise serene expression, wearing elegant earth tones, soft studio lighting, warm color palette, fine art portrait photography' },

  // Guys
  { name: 'Kai', prompt: 'Professional portrait of a confident young East Asian man with short black hair, brown eyes, charming smile, wearing a fitted dark henley shirt, urban background blurred, editorial fashion photography, warm tones' },
  { name: 'Marcus', prompt: 'Professional portrait of a warm young Black man with short hair, brown eyes, genuine friendly smile, wearing a casual denim jacket, outdoor natural lighting, lifestyle photography style' },
  { name: 'Liam', prompt: 'Professional portrait of a young man with short brown hair, green eyes, witty confident smirk, wearing a casual blazer, cafe background blurred, warm natural lighting, editorial style portrait' },

  // Anime
  { name: 'Sakura', prompt: 'Anime character portrait, young woman with pink straight hair, green eyes, shy gentle expression, wearing a cute pastel school uniform, cherry blossom background, soft lighting, clean modern anime art style, vibrant colors, detailed eyes, Studio Ghibli inspired' },
  { name: 'Yuki', prompt: 'Anime character portrait, energetic young woman with short white hair, bright blue eyes, cheerful excited expression, wearing a colorful casual outfit, neon city background, modern anime art style, vibrant dynamic colors, detailed illustration' },
  { name: 'Mia', prompt: 'Anime character portrait, gentle young woman with long purple hair, gray eyes, soft shy smile, wearing a cozy oversized sweater, rainy window background, modern anime art style, soft muted colors, atmospheric, detailed illustration' },
];

async function main() {
  console.log('🎨 Starting preset avatar generation...');
  console.log(`📁 Saving to: ${finalUploadDir}`);
  console.log(`🔑 OpenAI key: ${process.env.OPENAI_API_KEY ? 'SET' : 'MISSING'}`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL ? 'SET' : 'MISSING'}`);
  console.log('');

  let success = 0;
  let failed = 0;

  for (const preset of PRESET_PROMPTS) {
    try {
      console.log(`🎨 Generating ${preset.name}...`);
      const buffer = await generateImage(preset.prompt);
      
      const filename = `preset-${preset.name.toLowerCase()}-${Date.now()}.png`;
      const filepath = path.join(finalUploadDir, filename);
      fs.writeFileSync(filepath, buffer);
      
      const avatarUrl = `/uploads/${filename}`;
      
      // Update database
      const result = await pool.query(
        'UPDATE companions SET avatar_url = $1 WHERE name = $2 AND is_preset = true',
        [avatarUrl, preset.name]
      );
      
      if (result.rowCount > 0) {
        console.log(`  ✅ ${preset.name}: saved (${Math.round(buffer.length / 1024)}KB) → ${avatarUrl}`);
      } else {
        console.log(`  ⚠️  ${preset.name}: image saved but no DB row found (name mismatch?)`);
      }
      
      success++;
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log(`  ❌ ${preset.name}: ${err.message}`);
      failed++;
      // Wait longer on error (might be rate limited)
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('');
  console.log(`✅ Done! ${success} generated, ${failed} failed`);
  console.log('');
  
  // Show current state
  const companions = await pool.query('SELECT name, avatar_url FROM companions WHERE is_preset = true ORDER BY name');
  console.log('Current preset avatars:');
  companions.rows.forEach(c => {
    const hasImage = c.avatar_url?.startsWith('/uploads/preset-');
    console.log(`  ${hasImage ? '🖼️ ' : '📷'} ${c.name}: ${c.avatar_url || 'none'}`);
  });

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
