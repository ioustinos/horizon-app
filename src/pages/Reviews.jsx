import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'

// Reviews — breakfast ratings collected over WhatsApp quick-reply buttons.
// 3 = great (guest was routed to the public Google review link),
// 1-2 = unhappy (their free-text follow-up lands here privately).

const RATING_META = {
  3: { label: '😍 Great',    cls: 'badge-success' },
  2: { label: '🙂 Okay',     cls: 'badge-info' },
  1: { label: '😞 Not good', cls: 'badge-status cancelled' },
}

export default function Reviews() {
  const [reviews, setReviews] = useState([])
  const [stores, setStores]   = useState([])
  const [loading, setLoading] = useState(true)

  const [filterStore,  setFilterStore]  = useState('')
  const [filterRating, setFilterRating] = useState('')

  useEffect(() => {
    supabase.from('stores').select('id, name').order('name')
      .then(({ data }) => setStores(data || []))
  }, [])

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('reviews')
      .select('*, stores(id, name)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filterStore)  query = query.eq('store_id', filterStore)
    if (filterRating) query = query.eq('rating', Number(filterRating))

    const { data, error } = await query
    if (!error) setReviews(data || [])
    setLoading(false)
  }, [filterStore, filterRating])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  const stats = useMemo(() => {
    const rated = reviews.filter(r => r.rating)
    const avg = rated.length
      ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1)
      : '—'
    return {
      total: reviews.length,
      great: reviews.filter(r => r.rating === 3).length,
      unhappy: reviews.filter(r => r.rating === 1 || r.rating === 2).length,
      withComment: reviews.filter(r => r.comment).length,
      avg,
    }
  }, [reviews])

  function fmtTime(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reviews</h1>
          <p className="page-subtitle">Breakfast ratings and private feedback collected over WhatsApp</p>
        </div>
        <button className="btn btn-ghost" onClick={fetchReviews}>↻ Refresh</button>
      </div>

      <div className="stats-bar">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Reviews</span>
        </div>
        <div className="stat-card" style={{ borderColor: '#86efac' }}>
          <span className="stat-value" style={{ color: '#16a34a' }}>{stats.great}</span>
          <span className="stat-label">Great (3/3)</span>
        </div>
        <div className="stat-card" style={{ borderColor: '#fca5a5' }}>
          <span className="stat-value" style={{ color: '#dc2626' }}>{stats.unhappy}</span>
          <span className="stat-label">Unhappy (1-2)</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.avg}</span>
          <span className="stat-label">Average</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.withComment}</span>
          <span className="stat-label">With comment</span>
        </div>
      </div>

      <div className="toolbar">
        <select className="filter-select" value={filterStore} onChange={e => setFilterStore(e.target.value)}>
          <option value="">All stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="filter-select" value={filterRating} onChange={e => setFilterRating(e.target.value)}>
          <option value="">All ratings</option>
          <option value="3">😍 Great</option>
          <option value="2">🙂 Okay</option>
          <option value="1">😞 Not good</option>
        </select>
        {(filterStore || filterRating) && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setFilterStore(''); setFilterRating('')
          }}>Clear</button>
        )}
      </div>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="empty-state">
          No reviews yet. Ratings arrive here when guests tap the quick-reply
          buttons on the WhatsApp review request.
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Store</th>
                <th>Phone</th>
                <th>Rating</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r.id}>
                  <td>{fmtTime(r.created_at)}</td>
                  <td>{r.stores?.name || '—'}</td>
                  <td>{r.phone}</td>
                  <td>
                    {r.rating
                      ? <span className={`badge ${RATING_META[r.rating].cls}`}>{RATING_META[r.rating].label}</span>
                      : <span className="badge badge-neutral">comment only</span>}
                  </td>
                  <td style={{ whiteSpace: 'pre-wrap', maxWidth: 420 }}>{r.comment || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
