import { useAuth } from '../hooks/useAuth';
import { Avatar } from './UI';
import { getPlanInfo, getMessagesLeft } from '../utils/api';

const NAV = [
  { id:'home', icon:'🏠', label:'Home' },
  { id:'discover', icon:'🔍', label:'Discover' },
  { id:'chats', icon:'💬', label:'Chat' },
  { id:'collection', icon:'💎', label:'Collection' },
  { id:'create', icon:'✨', label:'Create Character' },
  { id:'my-ai', icon:'❤️', label:'My AI' },
];

export default function Sidebar({ currentPage, onNavigate, isOpen, onClose }) {
  const { user, logout } = useAuth();
  return (
    <>
      <div className={`sidebar-overlay ${isOpen?'open':''}`} onClick={onClose}/>
      <aside className={`sidebar ${isOpen?'open':''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">✦</div>
          <span className="sidebar-brand-text">Aura AI</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n=>(
            <button key={n.id} className={`nav-item ${currentPage===n.id?'active':''}`}
              onClick={()=>{onNavigate(n.id);onClose();}}>
              <span className="nav-item-icon">{n.icon}</span>{n.label}
            </button>
          ))}
          {user?.is_admin && <>
            <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'8px 0'}}/>
            <button className={`nav-item ${currentPage==='admin'?'active':''}`} onClick={()=>{onNavigate('admin');onClose();}}>
              <span className="nav-item-icon">⚙️</span>Admin Panel
            </button>
          </>}
          <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'8px 0'}}/>
          <button className={`nav-item ${currentPage==='pricing'?'active':''}`} onClick={()=>{onNavigate('pricing');onClose();}}>
            <span className="nav-item-icon">💎</span>
            <span>Premium</span>
            <span style={{marginLeft:'auto',background:'var(--red)',color:'#fff',fontSize:9,padding:'2px 6px',borderRadius:8,fontWeight:700}}>HOT</span>
          </button>
        </nav>
        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <Avatar name={user.name} src={user.avatar_url} size="xs"/>
              <div style={{flex:1,minWidth:0}}>
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-plan">{user.plan?getPlanInfo(user.plan)?.name:'Free Trial'}</div>
              </div>
            </div>
            {!user.is_admin && <div style={{fontSize:10,color:'var(--text2)',marginBottom:8}}>{getMessagesLeft(user)} msgs left</div>}
            <div className="sidebar-actions">
              {!user.plan&&!user.is_admin && <button className="btn btn-primary btn-sm" style={{flex:1}} onClick={()=>{onNavigate('pricing');onClose();}}>Upgrade</button>}
              <button className="btn btn-secondary btn-sm" style={{flex:1}} onClick={logout}>Logout</button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
