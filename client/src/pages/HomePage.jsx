import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { CompanionCard } from '../components/UI';

const CATS = ['Girls','Anime','Guys'];
const FAQS = [
  {q:'What is Aura AI?',a:'Aura AI is a premium AI companion platform. Create personalized AI friends with unique personalities, looks, and interests. Chat anytime for meaningful conversations.'},
  {q:'Is it safe?',a:'Yes. Encrypted, content-filtered, privacy-first. Fully Stripe/PayPal compliant.'},
  {q:'Can I customize?',a:'Everything — ethnicity, hair, eyes, personality, voice, hobbies. Upload images or generate with AI.'},
  {q:'How does the trial work?',a:'24-hour free trial, 50 messages, 1 companion. Subscribe after to continue.'},
  {q:'Payment methods?',a:'Stripe and PayPal. Discreet billing, no reference to Aura AI on statements.'},
];

export default function HomePage({ onNavigate, onChat, onToggleSave, collection, onRequireAuth }) {
  const { user } = useAuth();
  const [cat, setCat] = useState('Girls');
  const [presets, setPresets] = useState([]);
  const [faqOpen, setFaqOpen] = useState(null);

  useEffect(() => { api('/companions/presets').then(d=>setPresets(d.companions||[])).catch(()=>{}); }, []);

  const filtered = presets.filter(c=>c.category===cat);
  const girls = presets.filter(c=>c.category==='Girls');
  const hero = girls.slice(0,5);
  const go = c => { if(!user) onRequireAuth('signup'); else onChat(c); };

  return (
    <div>
      {/* ====== HERO BANNER — FULL WIDTH WITH CHARACTER IMAGES ====== */}
      <div style={{
        position:'relative', overflow:'hidden',
        background:'linear-gradient(160deg, #14081a 0%, #0b0b0f 40%, #0f0818 100%)',
        minHeight: 460,
      }}>
        {/* Background effects */}
        <div style={{position:'absolute',top:'-15%',right:'15%',width:450,height:450,borderRadius:'50%',background:'radial-gradient(circle,rgba(232,67,126,0.08) 0%,transparent 70%)',pointerEvents:'none'}}/>
        <div style={{position:'absolute',bottom:'-20%',left:'5%',width:350,height:350,borderRadius:'50%',background:'radial-gradient(circle,rgba(214,56,100,0.06) 0%,transparent 70%)',pointerEvents:'none'}}/>

        <div style={{ maxWidth:1200, margin:'0 auto', padding:'45px 20px 35px', display:'flex', alignItems:'center', gap:24, flexWrap:'wrap', justifyContent:'center', position:'relative', zIndex:1 }}>

          {/* LEFT — Hero text */}
          <div style={{ flex:'1 1 380px', maxWidth:460 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:20, background:'rgba(232,67,126,0.1)', border:'1px solid rgba(232,67,126,0.2)', fontSize:11, fontWeight:600, color:'#ff5c8d', marginBottom:18 }}>
              ✦ #1 AI Companion Platform
            </div>
            <h1 style={{ fontSize:'clamp(32px,5vw,50px)', fontWeight:900, lineHeight:1.05, letterSpacing:-1.5, marginBottom:14 }}>
              Create your own<br/>
              <span style={{ background:'linear-gradient(135deg,#ff5c8d,#ff87ab)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>AI Companion</span>
            </h1>
            <p style={{ color:'#9b9bb5', fontSize:15, lineHeight:1.65, marginBottom:26, maxWidth:380 }}>
              Always available, always in the mood, and made just for you.
            </p>
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <button className="btn btn-primary btn-lg"
                onClick={()=>user?onNavigate('create'):onRequireAuth('signup')}
                style={{ boxShadow:'0 4px 24px rgba(232,67,126,0.3)' }}>
                ✨ {user?'Create Now':'Join for FREE'}
              </button>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ display:'flex' }}>
                  {hero.slice(0,3).map((c,i)=>(
                    <div key={c.id} style={{ width:26, height:26, borderRadius:'50%', overflow:'hidden', border:'2px solid #14081a', marginLeft:i?-7:0, zIndex:3-i, position:'relative' }}>
                      <img src={c.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:10 }}>
                  <span style={{color:'#ffd32a'}}>★★★★★</span><br/>
                  <span style={{color:'#8b8ba7'}}>Loved by thousands</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — Large character image grid (desktop only) */}
          <div className="hero-desktop" style={{ flex:'1 1 420px', maxWidth:600, display:'flex', gap:10, justifyContent:'center', alignItems:'flex-end', perspective:800 }}>
            {hero.slice(0,4).map((c,i)=>{
              const heights = [230,270,250,220];
              const offsets = [15,0,8,20];
              return (
                <div key={c.id} onClick={()=>go(c)} style={{
                  width: i===1?175:145, height:heights[i], borderRadius:16, overflow:'hidden',
                  position:'relative', cursor:'pointer', flexShrink:0,
                  border:`2px solid rgba(232,67,126,${i===1?0.45:0.15})`,
                  boxShadow: i===1?'0 12px 36px rgba(232,67,126,0.2)':'0 6px 20px rgba(0,0,0,0.4)',
                  transform:`translateY(${offsets[i]}px)`,
                  transition:'all 0.35s ease',
                }}
                  onMouseEnter={e=>{e.currentTarget.style.transform=`translateY(${offsets[i]-8}px) scale(1.03)`;e.currentTarget.style.borderColor='rgba(232,67,126,0.5)';}}
                  onMouseLeave={e=>{e.currentTarget.style.transform=`translateY(${offsets[i]}px) scale(1)`;e.currentTarget.style.borderColor=`rgba(232,67,126,${i===1?0.45:0.15})`;}}
                >
                  <img src={c.avatar_url} alt={c.name} style={{width:'100%',height:'100%',objectFit:'cover'}}
                    onError={e=>{e.target.parentNode.style.background='linear-gradient(135deg,#e8437e,#d63864)';e.target.style.display='none';}}/>
                  <div style={{position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(transparent,rgba(0,0,0,0.85))',padding:'28px 10px 10px'}}>
                    <div style={{fontWeight:700,fontSize:14}}>{c.name}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.55)'}}>{c.personality}</div>
                  </div>
                  <div style={{position:'absolute',top:7,right:7,background:'rgba(0,0,0,0.55)',borderRadius:10,padding:'2px 7px',fontSize:8,color:'#2ecc71',display:'flex',alignItems:'center',gap:3,backdropFilter:'blur(4px)'}}>
                    <span style={{width:5,height:5,borderRadius:'50%',background:'#2ecc71',display:'inline-block'}}/>Online
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ====== SCROLLING AVATAR ROW ====== */}
      <div style={{ padding:'22px 0', background:'var(--bg)', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', gap:20, justifyContent:'center', overflowX:'auto', padding:'0 16px', maxWidth:900, margin:'0 auto' }}>
          {girls.slice(0,8).map(c=>(
            <div key={c.id} style={{textAlign:'center',flexShrink:0,cursor:'pointer'}} onClick={()=>go(c)}>
              <div style={{
                width:62, height:62, borderRadius:'50%', overflow:'hidden',
                border:'2.5px solid rgba(232,67,126,0.3)', margin:'0 auto 5px',
                transition:'all 0.2s',
              }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='#e8437e';e.currentTarget.style.transform='scale(1.1)';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(232,67,126,0.3)';e.currentTarget.style.transform='scale(1)';}}
              >
                <img src={c.avatar_url} alt={c.name} style={{width:'100%',height:'100%',objectFit:'cover'}}
                  onError={e=>{e.target.parentNode.style.background='linear-gradient(135deg,#e8437e,#d63864)';e.target.style.display='none';}}/>
              </div>
              <div style={{fontSize:10,color:'#bbb',fontWeight:500}}>{c.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ====== CATEGORY TABS ====== */}
      <div style={{ display:'flex', justifyContent:'center', gap:8, padding:'24px 16px 16px' }}>
        {CATS.map(c=>(
          <button key={c} className={`chip ${cat===c?'active':''}`} onClick={()=>setCat(c)}
            style={{padding:'9px 24px',fontSize:13,borderRadius:22}}>
            {c==='Girls'?'♀ ':c==='Guys'?'♂ ':'✿ '}{c}
          </button>
        ))}
      </div>

      {/* ====== CHARACTER GRID ====== */}
      <div className="section" style={{paddingTop:4}}>
        <div className="companion-grid">
          {filtered.map(c=>(
            <CompanionCard key={c.id} companion={c}
              onChat={()=>go(c)}
              onToggleSave={()=>{if(!user) onRequireAuth('signup'); else onToggleSave(c.id);}}
              isSaved={collection?.includes(c.id)}/>
          ))}
        </div>
      </div>

      {/* ====== CREATE CTA ====== */}
      <div style={{
        position:'relative', margin:'36px 16px', borderRadius:20,
        background:'linear-gradient(135deg,rgba(232,67,126,0.06),rgba(214,56,100,0.04))',
        border:'1px solid rgba(232,67,126,0.12)', overflow:'hidden',
        maxWidth:1060, marginLeft:'auto', marginRight:'auto',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:28,padding:'34px 30px',flexWrap:'wrap',justifyContent:'center'}}>
          <div style={{display:'flex',gap:8}}>
            {presets.slice(0,4).map((c,i)=>(
              <div key={c.id} style={{width:72,height:90,borderRadius:12,overflow:'hidden',border:'2px solid rgba(232,67,126,0.2)',transform:`rotate(${(i-1.5)*4}deg)`}}>
                <img src={c.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>{e.target.style.display='none';}}/>
              </div>
            ))}
          </div>
          <div style={{flex:1,minWidth:220}}>
            <h2 style={{fontSize:24,fontWeight:800,marginBottom:6}}>Create your own AI companion</h2>
            <p style={{color:'var(--text2)',fontSize:13,marginBottom:16,maxWidth:340}}>Shape their look, set their personality, choose their voice.</p>
            <button className="btn btn-primary" onClick={()=>user?onNavigate('create'):onRequireAuth('signup')}>✨ Create Your AI</button>
          </div>
        </div>
      </div>

      {/* ====== FEATURES ====== */}
      <div className="section" style={{maxWidth:860}}>
        <h2 className="section-title text-center">Everything You Need</h2>
        <p className="section-subtitle text-center" style={{maxWidth:380,margin:'0 auto 24px'}}>A complete AI companion experience</p>
        <div className="features-grid">
          {[
            {icon:'💬',title:'Text Chat',desc:'Natural conversations that feel real'},
            {icon:'🎤',title:'Voice Chat',desc:'Hear your companion talk back'},
            {icon:'🧠',title:'Memory',desc:'They remember and grow with you'},
            {icon:'🎭',title:'Roleplay',desc:'Creative scenarios together'},
            {icon:'🎨',title:'Customization',desc:'Design every detail'},
            {icon:'🔒',title:'Private & Secure',desc:'Encrypted and safe'},
          ].map((f,i)=>(
            <div key={i} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ====== FAQ ====== */}
      <div className="section" style={{maxWidth:620}}>
        <h2 className="section-title text-center mb-3">FAQ</h2>
        {FAQS.map((f,i)=>(
          <div key={i} className="faq-item">
            <button className="faq-question" onClick={()=>setFaqOpen(faqOpen===i?null:i)}>
              {f.q}<span className={`faq-arrow ${faqOpen===i?'open':''}`}>▾</span>
            </button>
            {faqOpen===i && <div className="faq-answer">{f.a}</div>}
          </div>
        ))}
      </div>

      {/* ====== FOOTER ====== */}
      <div style={{textAlign:'center',padding:'32px 16px 24px',borderTop:'1px solid var(--border)'}}>
        <div style={{fontSize:16,fontWeight:800,color:'var(--pink2)',marginBottom:4}}>Aura AI</div>
        <p style={{fontSize:11,color:'var(--text3)'}}>© 2026 Aura AI — Private, secure, encrypted.</p>
      </div>
    </div>
  );
}
