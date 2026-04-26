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
          avatar_seed INTEGER DEFAULT 0,
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
        ALTER TABLE companions ADD COLUMN IF NOT EXISTS avatar_seed INTEGER DEFAULT 0;
      `).catch(() => {});

      // Create token_ledger if not exists (already in CREATE above, this is safe)

      // Seed preset companions
      const presetCount = await client.query('SELECT COUNT(*) FROM companions WHERE is_preset = true');
      if (parseInt(presetCount.rows[0].count) === 0) {
        const presets = [
          { name: 'Aria',     category: 'Girls', ethnicity: 'Caucasian', age: '22-26', personality: 'Sweet & Caring',    tagline: 'Your sunshine on a cloudy day',    hair_color: 'Blonde', hair_style: 'Wavy',     eye_color: 'Blue',  body_type: 'Slim',     voice: 'Soft & Gentle',     hobbies: ['Yoga','Reading','Art'],           avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20woman%20blonde%20wavy%20hair%20blue%20eyes%20warm%20smile%20cream%20sweater%20golden%20hour%20lighting%20professional%20photography?width=512&height=512&seed=1001&nologo=true&model=flux' },
          { name: 'Luna',     category: 'Girls', ethnicity: 'Latina',    age: '23-27', personality: 'Bold & Confident',  tagline: "Life's an adventure — join me",    hair_color: 'Black',  hair_style: 'Long',     eye_color: 'Brown', body_type: 'Athletic', voice: 'Warm & Rich',       hobbies: ['Dancing','Travel','Fitness'],     avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20latina%20woman%20long%20dark%20hair%20brown%20eyes%20confident%20smile%20leather%20jacket%20urban%20background?width=512&height=512&seed=1002&nologo=true&model=flux' },
          { name: 'Sakura',   category: 'Anime', ethnicity: 'Asian',     age: '20-24', personality: 'Shy & Gentle',      tagline: "Let's share quiet moments",        hair_color: 'Pink',   hair_style: 'Straight', eye_color: 'Green', body_type: 'Petite',   voice: 'Soft & Gentle',     hobbies: ['Art','Music','Gaming'],           avatar_url: 'https://image.pollinations.ai/prompt/anime%20character%20portrait%20cute%20girl%20pink%20straight%20hair%20green%20eyes%20shy%20gentle%20expression%20pastel%20school%20uniform%20cherry%20blossom%20background%20modern%20anime%20art%20style%20vibrant%20colors%20detailed%20eyes?width=512&height=512&seed=2001&nologo=true&model=flux' },
          { name: 'Emilia',   category: 'Girls', ethnicity: 'Caucasian', age: '24-28', personality: 'Witty & Playful',   tagline: "I'll keep you on your toes",       hair_color: 'Red',    hair_style: 'Curly',    eye_color: 'Green', body_type: 'Curvy',    voice: 'Bright & Cheerful', hobbies: ['Music','Cooking','Photography'],  avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20woman%20red%20curly%20hair%20green%20eyes%20playful%20smile%20white%20blouse%20garden%20background%20warm%20lighting?width=512&height=512&seed=1004&nologo=true&model=flux' },
          { name: 'Zara',     category: 'Girls', ethnicity: 'African',   age: '22-26', personality: 'Energetic & Fun',   tagline: 'Every day is a celebration',       hair_color: 'Black',  hair_style: 'Curly',    eye_color: 'Brown', body_type: 'Athletic', voice: 'Bright & Cheerful', hobbies: ['Fitness','Dancing','Music'],      avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20black%20woman%20natural%20curly%20hair%20brown%20eyes%20radiant%20smile%20vibrant%20yellow%20top%20studio%20lighting?width=512&height=512&seed=1005&nologo=true&model=flux' },
          { name: 'Mei',      category: 'Girls', ethnicity: 'Asian',     age: '21-25', personality: 'Sweet & Caring',    tagline: "I'll always be here for you",      hair_color: 'Brown',  hair_style: 'Straight', eye_color: 'Hazel', body_type: 'Slim',     voice: 'Calm & Soothing',   hobbies: ['Reading','Cooking','Art'],        avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20east%20asian%20woman%20straight%20brown%20hair%20hazel%20eyes%20soft%20warm%20smile%20light%20blue%20cardigan%20cafe%20background?width=512&height=512&seed=1006&nologo=true&model=flux' },
          { name: 'Sofia',    category: 'Girls', ethnicity: 'Latina',    age: '25-29', personality: 'Wise & Calm',       tagline: "Let's talk about life",            hair_color: 'Brown',  hair_style: 'Wavy',     eye_color: 'Brown', body_type: 'Curvy',    voice: 'Warm & Rich',       hobbies: ['Photography','Travel','Reading'], avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20latina%20woman%20wavy%20brown%20hair%20brown%20eyes%20serene%20expression%20earth%20tone%20dress%20golden%20hour%20outdoor?width=512&height=512&seed=1007&nologo=true&model=flux' },
          { name: 'Nadia',    category: 'Girls', ethnicity: 'Arab',      age: '24-28', personality: 'Mysterious & Deep',  tagline: 'Stargazing and deep talks',        hair_color: 'Black',  hair_style: 'Long',     eye_color: 'Hazel', body_type: 'Slim',     voice: 'Calm & Soothing',   hobbies: ['Travel','Art','Reading'],         avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20middle%20eastern%20woman%20long%20dark%20hair%20hazel%20eyes%20mysterious%20smile%20elegant%20dark%20clothing%20dramatic%20studio%20lighting?width=512&height=512&seed=1008&nologo=true&model=flux' },
          { name: 'Kai',      category: 'Guys',  ethnicity: 'Asian',     age: '25-29', personality: 'Bold & Confident',  tagline: 'Your partner in every adventure',  hair_color: 'Black',  hair_style: 'Short',    eye_color: 'Brown', body_type: 'Athletic', voice: 'Deep & Confident',  hobbies: ['Gaming','Fitness','Music'],       avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20handsome%20young%20east%20asian%20man%20short%20black%20hair%20brown%20eyes%20charming%20confident%20smile%20dark%20henley%20shirt%20urban%20background?width=512&height=512&seed=3001&nologo=true&model=flux' },
          { name: 'Marcus',   category: 'Guys',  ethnicity: 'African',   age: '26-30', personality: 'Warm & Supportive', tagline: "I've got your back, always",        hair_color: 'Black',  hair_style: 'Short',    eye_color: 'Brown', body_type: 'Athletic', voice: 'Deep & Confident',  hobbies: ['Music','Cooking','Travel'],       avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20handsome%20young%20black%20man%20short%20hair%20brown%20eyes%20genuine%20friendly%20smile%20casual%20denim%20jacket%20outdoor%20natural%20lighting?width=512&height=512&seed=3002&nologo=true&model=flux' },
          { name: 'Elena',    category: 'Girls', ethnicity: 'Caucasian', age: '23-27', personality: 'Energetic & Fun',   tagline: "Let's make memories together",     hair_color: 'Blonde', hair_style: 'Straight', eye_color: 'Blue',  body_type: 'Athletic', voice: 'Bright & Cheerful', hobbies: ['Fitness','Photography','Dancing'], avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20woman%20straight%20blonde%20hair%20blue%20eyes%20energetic%20bright%20smile%20athletic%20casual%20wear%20outdoor%20park%20background?width=512&height=512&seed=1011&nologo=true&model=flux' },
          { name: 'Yuki',     category: 'Anime', ethnicity: 'Asian',     age: '20-24', personality: 'Playful & Energetic',tagline: "Let's make every moment count!",   hair_color: 'White',  hair_style: 'Short',    eye_color: 'Blue',  body_type: 'Petite',   voice: 'Bright & Cheerful', hobbies: ['Gaming','Art','Music'],           avatar_url: 'https://image.pollinations.ai/prompt/anime%20character%20portrait%20energetic%20girl%20short%20white%20hair%20bright%20blue%20eyes%20cheerful%20excited%20expression%20colorful%20casual%20outfit%20neon%20city%20background%20modern%20anime%20art%20style%20vibrant%20dynamic%20colors?width=512&height=512&seed=2002&nologo=true&model=flux' },
          { name: 'Isabella', category: 'Girls', ethnicity: 'Latina',    age: '24-28', personality: 'Sweet & Caring',    tagline: 'Mi corazón is yours',              hair_color: 'Black',  hair_style: 'Wavy',     eye_color: 'Brown', body_type: 'Curvy',    voice: 'Warm & Rich',       hobbies: ['Cooking','Dancing','Music'],      avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20latina%20woman%20wavy%20dark%20hair%20brown%20eyes%20warm%20sweet%20smile%20floral%20summer%20dress%20warm%20sunset%20lighting?width=512&height=512&seed=1013&nologo=true&model=flux' },
          { name: 'Liam',     category: 'Guys',  ethnicity: 'Caucasian', age: '27-31', personality: 'Witty & Playful',   tagline: 'A gentleman with a wild side',     hair_color: 'Brown',  hair_style: 'Short',    eye_color: 'Green', body_type: 'Athletic', voice: 'Warm & Rich',       hobbies: ['Travel','Cooking','Photography'], avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20handsome%20young%20man%20short%20brown%20hair%20green%20eyes%20witty%20confident%20smirk%20casual%20blazer%20cafe%20background%20warm%20natural%20lighting?width=512&height=512&seed=3003&nologo=true&model=flux' },
          { name: 'Aisha',    category: 'Girls', ethnicity: 'African',   age: '22-26', personality: 'Wise & Calm',       tagline: 'Beauty, brains, and soul',         hair_color: 'Black',  hair_style: 'Curly',    eye_color: 'Brown', body_type: 'Curvy',    voice: 'Calm & Soothing',   hobbies: ['Reading','Yoga','Art'],           avatar_url: 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20black%20woman%20curly%20natural%20hair%20brown%20eyes%20wise%20serene%20expression%20elegant%20earth%20tones%20soft%20studio%20lighting?width=512&height=512&seed=1015&nologo=true&model=flux' },
          { name: 'Mia',      category: 'Anime', ethnicity: 'Mixed',     age: '21-25', personality: 'Shy & Gentle',      tagline: 'Words speak louder in whispers',   hair_color: 'Purple', hair_style: 'Long',     eye_color: 'Gray',  body_type: 'Slim',     voice: 'Soft & Gentle',     hobbies: ['Art','Reading','Gaming'],         avatar_url: 'https://image.pollinations.ai/prompt/anime%20character%20portrait%20gentle%20girl%20long%20purple%20hair%20gray%20eyes%20soft%20shy%20smile%20cozy%20oversized%20sweater%20rainy%20window%20background%20modern%20anime%20art%20style%20soft%20muted%20colors%20atmospheric?width=512&height=512&seed=2003&nologo=true&model=flux' },
        ];

        for (const p of presets) {
          await client.query(
            `INSERT INTO companions (name, category, ethnicity, age_range, personality, tagline, hair_color, hair_style, eye_color, body_type, voice, hobbies, avatar_url, is_preset, is_public)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,true)`,
            [p.name, p.category, p.ethnicity, p.age, p.personality, p.tagline, p.hair_color, p.hair_style, p.eye_color, p.body_type, p.voice, p.hobbies, p.avatar_url]
          );
        }
        console.log('✅ Seeded 16 preset companions with images');
      } else {
        // Update existing presets that still use pravatar (broken) URLs
        const broken = await client.query("SELECT id, name, avatar_url FROM companions WHERE is_preset = true AND avatar_url LIKE '%pravatar%'");
        if (broken.rows.length > 0) {
          console.log(`🔄 Fixing ${broken.rows.length} preset avatars with broken pravatar URLs...`);
          const urlMap = {
            'Sakura': 'https://image.pollinations.ai/prompt/anime%20character%20portrait%20cute%20girl%20pink%20straight%20hair%20green%20eyes%20shy%20gentle%20expression%20pastel%20school%20uniform%20cherry%20blossom%20background%20modern%20anime%20art%20style%20vibrant%20colors%20detailed%20eyes?width=512&height=512&seed=2001&nologo=true&model=flux',
            'Yuki': 'https://image.pollinations.ai/prompt/anime%20character%20portrait%20energetic%20girl%20short%20white%20hair%20bright%20blue%20eyes%20cheerful%20excited%20expression%20colorful%20casual%20outfit%20neon%20city%20background%20modern%20anime%20art%20style%20vibrant%20dynamic%20colors?width=512&height=512&seed=2002&nologo=true&model=flux',
            'Mia': 'https://image.pollinations.ai/prompt/anime%20character%20portrait%20gentle%20girl%20long%20purple%20hair%20gray%20eyes%20soft%20shy%20smile%20cozy%20oversized%20sweater%20rainy%20window%20background%20modern%20anime%20art%20style%20soft%20muted%20colors%20atmospheric?width=512&height=512&seed=2003&nologo=true&model=flux',
            'Kai': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20handsome%20young%20east%20asian%20man%20short%20black%20hair%20brown%20eyes%20charming%20confident%20smile%20dark%20henley%20shirt%20urban%20background?width=512&height=512&seed=3001&nologo=true&model=flux',
            'Marcus': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20handsome%20young%20black%20man%20short%20hair%20brown%20eyes%20genuine%20friendly%20smile%20casual%20denim%20jacket%20outdoor%20natural%20lighting?width=512&height=512&seed=3002&nologo=true&model=flux',
            'Liam': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20handsome%20young%20man%20short%20brown%20hair%20green%20eyes%20witty%20confident%20smirk%20casual%20blazer%20cafe%20background%20warm%20natural%20lighting?width=512&height=512&seed=3003&nologo=true&model=flux',
          };
          // Also update all girls that use pravatar
          const girlUrlMap = {
            'Aria': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20woman%20blonde%20wavy%20hair%20blue%20eyes%20warm%20smile%20cream%20sweater%20golden%20hour%20lighting?width=512&height=512&seed=1001&nologo=true&model=flux',
            'Luna': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20latina%20woman%20long%20dark%20hair%20brown%20eyes%20confident%20smile%20leather%20jacket%20urban%20background?width=512&height=512&seed=1002&nologo=true&model=flux',
            'Emilia': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20woman%20red%20curly%20hair%20green%20eyes%20playful%20smile%20white%20blouse%20garden%20background?width=512&height=512&seed=1004&nologo=true&model=flux',
            'Zara': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20black%20woman%20natural%20curly%20hair%20brown%20eyes%20radiant%20smile%20vibrant%20yellow%20top?width=512&height=512&seed=1005&nologo=true&model=flux',
            'Mei': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20east%20asian%20woman%20straight%20brown%20hair%20hazel%20eyes%20soft%20warm%20smile%20light%20blue%20cardigan?width=512&height=512&seed=1006&nologo=true&model=flux',
            'Sofia': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20latina%20woman%20wavy%20brown%20hair%20brown%20eyes%20serene%20expression%20earth%20tone%20dress?width=512&height=512&seed=1007&nologo=true&model=flux',
            'Nadia': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20middle%20eastern%20woman%20long%20dark%20hair%20hazel%20eyes%20mysterious%20smile%20elegant%20dark%20clothing?width=512&height=512&seed=1008&nologo=true&model=flux',
            'Elena': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20woman%20straight%20blonde%20hair%20blue%20eyes%20energetic%20smile%20athletic%20casual%20wear%20outdoor%20park?width=512&height=512&seed=1011&nologo=true&model=flux',
            'Isabella': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20latina%20woman%20wavy%20dark%20hair%20brown%20eyes%20warm%20sweet%20smile%20floral%20summer%20dress%20sunset?width=512&height=512&seed=1013&nologo=true&model=flux',
            'Aisha': 'https://image.pollinations.ai/prompt/photorealistic%20portrait%20beautiful%20young%20black%20woman%20curly%20natural%20hair%20brown%20eyes%20wise%20serene%20expression%20elegant%20earth%20tones?width=512&height=512&seed=1015&nologo=true&model=flux',
          };
          const allMaps = { ...urlMap, ...girlUrlMap };
          for (const row of broken.rows) {
            const newUrl = allMaps[row.name];
            if (newUrl) {
              await client.query('UPDATE companions SET avatar_url = $1 WHERE id = $2', [newUrl, row.id]);
              console.log(`  ✅ Fixed ${row.name}`);
            }
          }
        }
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
