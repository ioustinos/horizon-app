import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'

const STATUS_LABEL = { confirmed: 'Confirmed', cancelled: 'Cancelled' }
const PROVIDER_LABEL = { hosthub: 'HostHub', webhotelier: 'WebHotelier' }

export default function Bookings() {
  const [bookings, setBookings]     = useState([])
  const [facilities, setFacilities] = useState([])
  const [stores, setStores]         = useState([])
  const [loading, setLoading]       = useState(true)

  // Filters
  const [filterFacility,  setFilterFacility]  = useState('')
  const [filterStore,     setFilterStore]     = useState('')
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterBreakfast, setFilterBreakfast] = useState('')
  const [filterProvider,  setFilterProvider]  = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [sortKey,  setSortKey]  = useState('check_in')
  const [sortDir,  setSortDir]  = useState('asc')

  useEffect(() => {
    Promise.all([
      supabase.from('facilities').select('id, name, store_id').order('name'),
      supabase.from('stores').select('id, name').order('name'),
    ]).then(([facRes, storeRes]) => {
      setFacilities(facRes.data || [])
      setStores(storeRes.data || [])
    })
  }, [])

  useEffect(() => {
    fetchBookings()
  }, [filterFacility, filterStore, filterStatus, filterBreakfast, filterProvider, dateFrom, dateTo])

  async function fetchBookings() {
    setLoading(true)

    // If filtering by store, resolve which facility IDs belong to it
    let facilityIdFilter = filterFacility || null
    if (filterStore && !filterFacility) {
      const storeFacilities = facilities.filter(f => f.store_id === filterStore)
      if (storeFacilities.length === 0) {
        setBookings([])
        setLoading(false)
        return
      }
    }

    let query = supabase
      .from('bookings')
      .select('*, facilities(id, name, facility_type, platform, store_id, stores(id, name))')
      .order('check_in', { ascending: true })
      .limit(500)

    if (facilityIdFilter) query = query.eq('facility_id', facilityIdFilter)
    if (filterStatus)    query = query.eq('status', filterStatus)
    if (filterProvider)  query = query.eq('provider', filterProvider)
    if (filterBreakfast !== '') query = query.eq('breakfast_included', filterBreakfast === 'yes')
    if (dateFrom)        query = query.gte('check_in', dateFrom)
    if (dateTo)          query = query.lte('check_in', dateTo)

    const { data, error } = await query
    if (!error) {
      let results = data || []
      // Client-side store filter (via nested facility.store_id)
      if (filterStore) {
        results = results.filter(b => b.facilities?.store_id === filterStore)
      }
      setBookings(results)
    }
    setLoading(false)
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    return [...bookings].sort((a, b) => {
      const av = (a[sortKey] || '').toString()
      const bv = (b[sortKey] || '').toString()
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [bookings, sortKey, sortDir])

  // Summary stats
  const stats = useMemo(() => {
    const confirmed = sorted.filter(b => b.status === 'confirmed')
    const totalGuests = confirmed.reduce((s, b) => s + (b.guest_count || 0), 0)
    const withBreakfast = confirmed.filter(b => b.breakfast_included)
    const breakfastGuests = withBreakfast.reduce((s, b) => s + (b.guest_count || 0), 0)
    return { total: sorted.length, confirmed: confirmed.length, totalGuests, breakfastGuests }
  }, [sorted])

  function nights(b) {
    if (!b.check_in || !b.check_out) return '—'
    const d = (new Date(b.check_out) - new Date(b.check_in)) / 86400000
    return isNaN(d) ? '—' : d
  }

  function fmt(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="sort-icon">↕</span>
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function clearFilters() {
    setFilterFacility('')
    setFilterStore('')
    setFilterStatus('')
    setFilterBreakfast('')
    setFilterProvider('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = filterFacility || filterStore || filterStatus || filterBreakfast || filterProvider || dateFrom || dateTo

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">Live view of synced bookings across all facilities</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total bookings</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.confirmed}</span>
          <span className="stat-label">Confirmed</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.totalGuests}</span>
          <span className="stat-label">Total guests</span>
        </div>
        <div className="stat-card highlight">
          <span className="stat-value">{stats.breakfastGuests}</span>
          <span className="stat-label">Breakfast entitled</span>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-panel">
        <div className="filter-row">
          <select className="filter-select" value={filterStore} onChange={e => { setFilterStore(e.target.value); setFilterFacility('') }}>
            <option value="">All stores</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="filter-select" value={filterFacility} onChange={e => { setFilterFacility(e.target.value); setFilterStore('') }}>
            <option value="">All facilities</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="filter-select" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
            <option value="">All platforms</option>
            <option value="hosthub">HostHub</option>
            <option value="webhotelier">WebHotelier</option>
          </select>
          <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="filter-select" value={filterBreakfast} onChange={e => setFilterBreakfast(e.target.value)}>
            <option value="">All bookings</option>
            <option value="yes">Breakfast included</option>
            <option value="no">No breakfast</option>
          </select>
        </div>
        <div className="filter-row">
          <label className="date-label">Check-in from</label>
          <input className="date-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <label className="date-label">to</label>
          <input className="date-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
          )}
          <span className="result-count">{sorted.length} booking{sorted.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p>{hasFilters ? 'No bookings match your filters.' : 'No bookings synced yet. Run a sync from the Facilities page.'}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Reservation ID</th>
                <th>Platform</th>
                <th onClick={() => handleSort('check_in')} className="sortable">
                  Check-in <SortIcon col="check_in" />
                </th>
                <th onClick={() => handleSort('check_out')} className="sortable">
                  Check-out <SortIcon col="check_out" />
                </th>
                <th>Nights</th>
                <th onClick={() => handleSort('guest_count')} className="sortable">
                  Guests <SortIcon col="guest_count" />
                </th>
                <th>Breakfast</th>
                <th onClick={() => handleSort('status')} className="sortable">
                  Status <SortIcon col="status" />
                </th>
                <th onClick={() => handleSort('created_at')} className="sortable">
                  Booked On <SortIcon col="created_at" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(b => (
                <tr key={b.id} className={b.status === 'cancelled' ? 'row-cancelled' : ''}>
                  <td>
                    <div className="cell-primary">{b.facilities?.name || '—'}</div>
                    {b.facilities?.stores?.name && (
                      <div className="cell-secondary">{b.facilities.stores.name}</div>
                    )}
                  </td>
                  <td>
                    {b.external_id ? (
                      b.raw_data?.infourl ? (
                        <a href={b.raw_data.infourl} target="_blank" rel="noopener noreferrer" className="code-chip code-link">
                          {b.external_id} ↗
                        </a>
                      ) : (
                        <code className="code-chip">{b.external_id}</code>
                      )
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <span className={`badge badge-platform ${b.provider}`}>
                      {PROVIDER_LABEL[b.provider] || b.provider}
                    </span>
                  </td>
                  <td className="cell-date">{fmt(b.check_in)}</td>
                  <td className="cell-date">{fmt(b.check_out)}</td>
                  <td className="cell-number">{nights(b)}</td>
                  <td className="cell-number">{b.guest_count}</td>
                  <td>
                    {b.breakfast_included
                      ? <span className="badge badge-breakfast">Yes</span>
                      : <span className="muted">No</span>}
                  </td>
                  <td>
                    <span className={`badge badge-status ${b.status}`}>
                      {STATUS_LABEL[b.status] || b.status}
                    </span>
                  </td>
                  <td className="cell-date">{fmt(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
