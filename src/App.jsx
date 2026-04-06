import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login      from './pages/Login'
import AdminLayout from './pages/AdminLayout'
import Stores          from './pages/Stores'
import Rooms           from './pages/Rooms'
import Bookings        from './pages/Bookings'
import SyncLogs        from './pages/SyncLogs'
import Settings        from './pages/Settings'
import PullListings    from './pages/PullListings'
import TestWebhook     from './pages/TestWebhook'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/stores" replace />} />
            <Route path="stores"     element={<Stores />} />
            <Route path="rooms"      element={<Rooms />} />
            <Route path="bookings"      element={<Bookings />} />
            <Route path="sync-logs"     element={<SyncLogs />} />
            <Route path="pull-listings" element={<PullListings />} />
            <Route path="settings"      element={<Settings />} />
            <Route path="test-webhook"  element={<TestWebhook />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
