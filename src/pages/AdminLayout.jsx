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
            <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
            Stores
          </NavLink>
          <NavLink to="/admin/facilities" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            Facilities
          </NavLink>

          <p className="nav-section-label" style={{ marginTop: '1rem' }}>Data</p>
          <NavLink to="/admin/bookings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            Bookings
          </NavLink>

          <p className="nav-section-label" style={{ marginTop: '1rem' }}>System</p>
          <NavLink to="/admin/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Settings
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
