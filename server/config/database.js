const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

async function initDatabase() {
  let retries = 5;
  while (retries > 0) {
    let client;
    try {
      client = await pool.connect();

      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          avatar_url TEXT,
          plan VARCHAR(50) DEFAULT NULL,
          plan_started_at TIMESTAMPTZ,
          messages_used INTEGER DEFAULT 0,
          messages_reset_at TIMESTAMPTZ DEFAULT NOW(),
          tokens INTEGER DEFAULT 0,
          trial_start TIMESTAMPTZ DEFAULT NOW(),
          is_admin BOOLEAN DEFAULT FALSE,
          stripe_customer_id VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS companions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          category VARCHAR(50) DEFAULT 'Girls',
          art_style VARCHAR(50) DEFAULT 'Realistic',
          ethnicity VARCHAR(100),
          age_range VARCHAR(20),
          eye_color VARCHAR(50),
          hair_style VARCHAR(100),
          hair_color VARCHAR(50),
          body_type VARCHAR(50),
          personality VARCHAR(255),
          voice VARCHAR(100),
          hobbies TEXT[],
          description TEXT,
          tagline VARCHAR(500),
          avatar_url TEXT,
          is_preset BOOLEAN DEFAULT FALSE,
          is_public BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          companion_id UUID REFERENCES companions(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL,
          content TEXT NOT NULL,
          type VARCHAR(20) DEFAULT 'text',
          media_url TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS collections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          companion_id UUID REFERENCES companions(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(user_id, companion_id)
        );

        CREATE TABLE IF NOT EXISTS payments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          amount DECIMAL(10,2) NOT NULL,
          currency VARCHAR(3) DEFAULT 'USD',
          plan VARCHAR(50),
          payment_method VARCHAR(50),
          payment_id VARCHAR(255),
          status VARCHAR(50) DEFAULT 'completed',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS token_ledger (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          amount INTEGER NOT NULL,
          action VARCHAR(50) NOT NULL,
          description TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_messages_user_companion ON messages(user_id, companion_id);
        CREATE INDEX IF NOT EXISTS idx_companions_user ON companions(user_id);
        CREATE INDEX IF NOT EXISTS idx_companions_preset ON companions(is_preset);
        CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);
        CREATE INDEX IF NOT EXISTS idx_token_ledger_user ON token_ledger(user_id);
      `);

      // Add tokens column if missing (migration for existing DBs)
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens INTEGER DEFAULT 0;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'text';
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
      `).catch(() => {});

      // Create token_ledger if not exists (already in CREATE above, this is safe)

      // Seed preset companions
      const presetCount = await client.query('SELECT COUNT(*) FROM companions WHERE is_preset = true');
      if (parseInt(presetCount.rows[0].count) === 0) {
        const presets = [
          { name: 'Aria',     category: 'Girls', ethnicity: 'Caucasian', age: '22-26', personality: 'Sweet & Caring',    tagline: 'Your sunshine on a cloudy day',    hair_color: 'Blonde', hair_style: 'Wavy',     eye_color: 'Blue',  body_type: 'Slim',     voice: 'Soft & Gentle',     hobbies: ['Yoga','Reading','Art'],           avatar_url: 'https://i.pravatar.cc/400?img=1' },
          { name: 'Luna',     category: 'Girls', ethnicity: 'Latina',    age: '23-27', personality: 'Bold & Confident',  tagline: "Life's an adventure — join me",    hair_color: 'Black',  hair_style: 'Long',     eye_color: 'Brown', body_type: 'Athletic', voice: 'Warm & Rich',       hobbies: ['Dancing','Travel','Fitness'],     avatar_url: 'https://i.pravatar.cc/400?img=5' },
          { name: 'Sakura',   category: 'Anime', ethnicity: 'Asian',     age: '20-24', personality: 'Shy & Gentle',      tagline: "Let's share quiet moments",        hair_color: 'Pink',   hair_style: 'Straight', eye_color: 'Green', body_type: 'Petite',   voice: 'Soft & Gentle',     hobbies: ['Art','Music','Gaming'],           avatar_url: 'https://i.pravatar.cc/400?img=9' },
          { name: 'Emilia',   category: 'Girls', ethnicity: 'Caucasian', age: '24-28', personality: 'Witty & Playful',   tagline: "I'll keep you on your toes",       hair_color: 'Red',    hair_style: 'Curly',    eye_color: 'Green', body_type: 'Curvy',    voice: 'Bright & Cheerful', hobbies: ['Music','Cooking','Photography'],  avatar_url: 'https://i.pravatar.cc/400?img=16' },
          { name: 'Zara',     category: 'Girls', ethnicity: 'African',   age: '22-26', personality: 'Energetic & Fun',   tagline: 'Every day is a celebration',       hair_color: 'Black',  hair_style: 'Curly',    eye_color: 'Brown', body_type: 'Athletic', voice: 'Bright & Cheerful', hobbies: ['Fitness','Dancing','Music'],      avatar_url: 'https://i.pravatar.cc/400?img=20' },
          { name: 'Mei',      category: 'Girls', ethnicity: 'Asian',     age: '21-25', personality: 'Sweet & Caring',    tagline: "I'll always be here for you",      hair_color: 'Brown',  hair_style: 'Straight', eye_color: 'Hazel', body_type: 'Slim',     voice: 'Calm & Soothing',   hobbies: ['Reading','Cooking','Art'],        avatar_url: 'https://i.pravatar.cc/400?img=25' },
          { name: 'Sofia',    category: 'Girls', ethnicity: 'Latina',    age: '25-29', personality: 'Wise & Calm',       tagline: "Let's talk about life",            hair_color: 'Brown',  hair_style: 'Wavy',     eye_color: 'Brown', body_type: 'Curvy',    voice: 'Warm & Rich',       hobbies: ['Photography','Travel','Reading'], avatar_url: 'https://i.pravatar.cc/400?img=32' },
          { name: 'Nadia',    category: 'Girls', ethnicity: 'Arab',      age: '24-28', personality: 'Mysterious & Deep',  tagline: 'Stargazing and deep talks',        hair_color: 'Black',  hair_style: 'Long',     eye_color: 'Hazel', body_type: 'Slim',     voice: 'Calm & Soothing',   hobbies: ['Travel','Art','Reading'],         avatar_url: 'https://i.pravatar.cc/400?img=24' },
          { name: 'Kai',      category: 'Guys',  ethnicity: 'Asian',     age: '25-29', personality: 'Bold & Confident',  tagline: 'Your partner in every adventure',  hair_color: 'Black',  hair_style: 'Short',    eye_color: 'Brown', body_type: 'Athletic', voice: 'Deep & Confident',  hobbies: ['Gaming','Fitness','Music'],       avatar_url: 'https://i.pravatar.cc/400?img=52' },
          { name: 'Marcus',   category: 'Guys',  ethnicity: 'African',   age: '26-30', personality: 'Warm & Supportive', tagline: "I've got your back, always",        hair_color: 'Black',  hair_style: 'Short',    eye_color: 'Brown', body_type: 'Athletic', voice: 'Deep & Confident',  hobbies: ['Music','Cooking','Travel'],       avatar_url: 'https://i.pravatar.cc/400?img=53' },
          { name: 'Elena',    category: 'Girls', ethnicity: 'Caucasian', age: '23-27', personality: 'Energetic & Fun',   tagline: "Let's make memories together",     hair_color: 'Blonde', hair_style: 'Straight', eye_color: 'Blue',  body_type: 'Athletic', voice: 'Bright & Cheerful', hobbies: ['Fitness','Photography','Dancing'], avatar_url: 'https://i.pravatar.cc/400?img=44' },
          { name: 'Yuki',     category: 'Anime', ethnicity: 'Asian',     age: '20-24', personality: 'Playful & Energetic',tagline: "Let's make every moment count!",   hair_color: 'White',  hair_style: 'Short',    eye_color: 'Blue',  body_type: 'Petite',   voice: 'Bright & Cheerful', hobbies: ['Gaming','Art','Music'],           avatar_url: 'https://i.pravatar.cc/400?img=47' },
          { name: 'Isabella', category: 'Girls', ethnicity: 'Latina',    age: '24-28', personality: 'Sweet & Caring',    tagline: 'Mi corazón is yours',              hair_color: 'Black',  hair_style: 'Wavy',     eye_color: 'Brown', body_type: 'Curvy',    voice: 'Warm & Rich',       hobbies: ['Cooking','Dancing','Music'],      avatar_url: 'https://i.pravatar.cc/400?img=45' },
          { name: 'Liam',     category: 'Guys',  ethnicity: 'Caucasian', age: '27-31', personality: 'Witty & Playful',   tagline: 'A gentleman with a wild side',     hair_color: 'Brown',  hair_style: 'Short',    eye_color: 'Green', body_type: 'Athletic', voice: 'Warm & Rich',       hobbies: ['Travel','Cooking','Photography'], avatar_url: 'https://i.pravatar.cc/400?img=51' },
          { name: 'Aisha',    category: 'Girls', ethnicity: 'African',   age: '22-26', personality: 'Wise & Calm',       tagline: 'Beauty, brains, and soul',         hair_color: 'Black',  hair_style: 'Curly',    eye_color: 'Brown', body_type: 'Curvy',    voice: 'Calm & Soothing',   hobbies: ['Reading','Yoga','Art'],           avatar_url: 'https://i.pravatar.cc/400?img=23' },
          { name: 'Mia',      category: 'Anime', ethnicity: 'Mixed',     age: '21-25', personality: 'Shy & Gentle',      tagline: 'Words speak louder in whispers',   hair_color: 'Purple', hair_style: 'Long',     eye_color: 'Gray',  body_type: 'Slim',     voice: 'Soft & Gentle',     hobbies: ['Art','Reading','Gaming'],         avatar_url: 'https://i.pravatar.cc/400?img=36' },
        ];

        for (const p of presets) {
          await client.query(
            `INSERT INTO companions (name, category, ethnicity, age_range, personality, tagline, hair_color, hair_style, eye_color, body_type, voice, hobbies, avatar_url, is_preset, is_public)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,true)`,
            [p.name, p.category, p.ethnicity, p.age, p.personality, p.tagline, p.hair_color, p.hair_style, p.eye_color, p.body_type, p.voice, p.hobbies, p.avatar_url]
          );
        }
        console.log('✅ Seeded 16 preset companions with images');
      }

      // Create default admin user
      const adminExists = await client.query("SELECT id FROM users WHERE email = 'admin@aura.ai'");
      if (adminExists.rows.length === 0) {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash('admin123', 10);
        await client.query(
          `INSERT INTO users (email, name, password_hash, is_admin, plan, tokens) VALUES ('admin@aura.ai', 'Admin', $1, true, 'premium', 500)`,
          [hash]
        );
        console.log('✅ Created admin user (admin@aura.ai / admin123)');
      }

      // Give existing admin users tokens if they have 0
      await client.query(`UPDATE users SET tokens = 500 WHERE is_admin = true AND (tokens IS NULL OR tokens = 0)`).catch(() => {});

      console.log('✅ Database initialized successfully');
      client.release();
      return;
    } catch (err) {
      if (client) client.release();
      retries--;
      console.error(`Database init attempt failed (${retries} retries left):`, err.message);
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

module.exports = { pool, initDatabase };
