import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function AdminLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo-mark">H</span>
          <span className="logo-text">Horizon</span>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-section-label">Manage</p>
          <NavLink to="/admin/stores" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
            Stores
          </NavLink>
          <NavLink to="/admin/facilities" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            Facilities
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <p className="user-email">{user?.email}</p>
          <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
