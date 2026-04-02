import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'
import FacilityForm from '../components/FacilityForm'

const PLATFORM_LABEL = { hosthub: 'HostHub', webhotelier: 'WebHotelier' }
const TYPE_LABEL     = { hotel: 'Hotel', airbnb: 'Airbnb' }

export default function Facilities() {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterType, setFilterType]           = useState('')
  const [filterPlatform, setFilterPlatform]   = useState('')
  const [sortKey, setSortKey]       = useState('name')
  const [sortDir, setSortDir]       = useState('asc')
  const [showForm, setShowForm]     = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [syncingId, setSyncingId]   = useState(null)  // which facility is syncing
  const [syncResults, setSyncResults] = useState({})  // facility_id → { ok, message }

  async function fetchFacilities() {
    setLoading(true)
    const { data, error } = await supabase
      .from('facilities')
      .select('*, stores(id, name)')
      .order('created_at', { ascending: false })
    if (!error) setFacilities(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchFacilities() }, [])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return facilities
      .filter(f => {
        const matchSearch =
          f.name.toLowerCase().includes(q) ||
          (f.secondary_name || '').toLowerCase().includes(q) ||
          (f.external_id || '').toLowerCase().includes(q)
        const matchType     = !filterType     || f.facility_type === filterType
        const matchPlatform = !filterPlatform || f.platform === filterPlatform
        return matchSearch && matchType && matchPlatform
      })
      .sort((a, b) => {
        const av = (a[sortKey] || '').toString().toLowerCase()
        const bv = (b[sortKey] || '').toString().toLowerCase()
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
  }, [facilities, search, filterType, filterPlatform, sortKey, sortDir])

  function openCreate() { setEditTarget(null); setShowForm(true) }
  function openEdit(f)  { setEditTarget(f);    setShowForm(true) }

  async function handleDelete(f) {
    if (!confirm(`Delete facility "${f.name}"? This cannot be undone.`)) return
    await supabase.from('facilities').delete().eq('id', f.id)
    fetchFacilities()
  }

  async function handleForceSync(f) {
    if (syncingId) return
    setSyncingId(f.id)
    setSyncResults(r => ({ ...r, [f.id]: null }))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`/api/force-sync?facility_id=${f.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })
      const result = await res.json()

      if (result.error) {
        setSyncResults(r => ({ ...r, [f.id]: { ok: false, message: result.error } }))
      } else {
        setSyncResults(r => ({
          ...r,
          [f.id]: {
            ok: true,
            message: `Synced ${result.fetched ?? 0} bookings (${result.inserted ?? 0} new)`,
          },
        }))
        // Refresh to show updated last_synced_at
        fetchFacilities()
      }
    } catch (err) {
      setSyncResults(r => ({ ...r, [f.id]: { ok: false, message: err.message } }))
    }
    setSyncingId(null)
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="sort-icon">↕</span>
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function formatDate(ts) {
    if (!ts) return null
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Facilities</h1>
          <p className="page-subtitle">Hotels and Airbnbs connected to Horizon</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Facility</button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search facilities…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All types</option>
          <option value="hotel">Hotel</option>
          <option value="airbnb">Airbnb</option>
        </select>
        <select className="filter-select" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="">All platforms</option>
          <option value="hosthub">HostHub</option>
          <option value="webhotelier">WebHotelier</option>
        </select>
        <span className="result-count">{filtered.length} facilit{filtered.length !== 1 ? 'ies' : 'y'}</span>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{search || filterType || filterPlatform
            ? 'No facilities match your filters.'
            : 'No facilities yet. Create your first one.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} className="sortable">
                  Name <SortIcon col="name" />
                </th>
                <th>Linked Store</th>
                <th>Type / Platform</th>
                <th>External ID</th>
                <th onClick={() => handleSort('max_capacity')} className="sortable">
                  Capacity <SortIcon col="max_capacity" />
                </th>
                <th>Last Sync</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => {
                const syncResult = syncResults[f.id]
                const isSyncing  = syncingId === f.id
                return (
                  <tr key={f.id}>
                    <td>
                      <div className="cell-primary">{f.name}</div>
                      {f.secondary_name && <div className="cell-secondary">{f.secondary_name}</div>}
                    </td>
                    <td>
                      {f.stores?.name
                        ? <span className="store-tag">{f.stores.name}</span>
                        : <span className="muted">Unlinked</span>}
                    </td>
                    <td>
                      <span className={`badge badge-type ${f.facility_type}`}>{TYPE_LABEL[f.facility_type]}</span>
                      <span className={`badge badge-platform ${f.platform}`}>{PLATFORM_LABEL[f.platform]}</span>
                    </td>
                    <td>
                      {f.external_id
                        ? <code className="code-chip">{f.external_id}</code>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="cell-number">{f.max_capacity ?? <span className="muted">—</span>}</td>
                    <td className="cell-date">
                      {f.last_synced_at ? (
                        <span className="sync-ok">{formatDate(f.last_synced_at)}</span>
                      ) : (
                        <span className="muted">Never synced</span>
                      )}
                      {syncResult && (
                        <div className={`sync-result ${syncResult.ok ? 'ok' : 'err'}`}>
                          {syncResult.ok ? '✓ ' : '✗ '}{syncResult.message}
                        </div>
                      )}
                    </td>
                    <td className="cell-actions">
                      <button
                        className={`btn btn-sync btn-sm ${isSyncing ? 'syncing' : ''}`}
                        onClick={() => handleForceSync(f)}
                        disabled={!!syncingId}
                        title="Force sync this facility now"
                      >
                        {isSyncing ? '⟳ Syncing…' : '⟳ Sync'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(f)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(f)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <FacilityForm
          facility={editTarget}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchFacilities() }}
        />
      )}
    </div>
  )
}
