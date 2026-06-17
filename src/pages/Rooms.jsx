import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'
import RoomForm from '../components/RoomForm'


// Inline ID + copy-to-clipboard chip used in the rooms table.
function CopyChip({ value, displayValue, title }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <code className="code-chip" title={title}>{displayValue ?? value}</code>
      <button
        type="button"
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        style={{
          border: 0, background: 'transparent', cursor: 'pointer', padding: '2px 4px',
          fontSize: 13, lineHeight: 1, color: copied ? '#16a34a' : '#64748b',
          borderRadius: 3,
        }}
        aria-label="Copy"
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  )
}

const PLATFORM_LABEL = { hosthub: 'HostHub', webhotelier: 'WebHotelier', roomrack: 'RoomRack', hotelizer: 'Hotelizer', cloudbeds: 'Cloudbeds', loggia: 'Loggia', other: 'Manual' }
const TYPE_LABEL     = { hotel: 'Hotel', airbnb: 'Airbnb', other_max_pax: 'Other (Max Pax)' }

export default function Rooms() {
  const [rooms, setRooms] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterType, setFilterType]           = useState('')
  const [filterPlatform, setFilterPlatform]   = useState('')
  const [filterStore, setFilterStore]         = useState('')
  const [sortKey, setSortKey]       = useState('name')
  const [sortDir, setSortDir]       = useState('asc')
  const [showForm, setShowForm]     = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [syncingId, setSyncingId]   = useState(null)
  const [syncResults, setSyncResults] = useState({})

  async function fetchRooms() {
    setLoading(true)
    const { data, error } = await supabase
      .from('rooms')
      .select('*, stores(id, name)')
      .order('created_at', { ascending: false })
    if (!error) setRooms(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchRooms()
    supabase.from('stores').select('id, name').order('name').then(({ data }) => {
      setStores(data || [])
    })
  }, [])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rooms
      .filter(f => {
        const matchSearch =
          f.name.toLowerCase().includes(q) ||
          (f.secondary_name || '').toLowerCase().includes(q) ||
          (f.platform_id || '').toLowerCase().includes(q)
        const matchType     = !filterType     || f.room_type === filterType
        const matchPlatform = !filterPlatform || f.platform === filterPlatform
        const matchStore    = !filterStore    || f.store_id === filterStore
        return matchSearch && matchType && matchPlatform && matchStore
      })
      .sort((a, b) => {
        const av = (a[sortKey] || '').toString().toLowerCase()
        const bv = (b[sortKey] || '').toString().toLowerCase()
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
  }, [rooms, search, filterType, filterPlatform, filterStore, sortKey, sortDir])

  function openCreate() { setEditTarget(null); setShowForm(true) }
  function openEdit(f)  { setEditTarget(f);    setShowForm(true) }

  async function handleDelete(f) {
    if (!confirm(`Delete room "${f.name}"? This cannot be undone.`)) return
    await supabase.from('rooms').delete().eq('id', f.id)
    fetchRooms()
  }

  async function handleForceSync(f) {
    if (syncingId) return
    setSyncingId(f.id)
    setSyncResults(r => ({ ...r, [f.id]: null }))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      // Note: /api/force-sync redirects to the background function. Background
      // functions return HTTP 202 immediately and run async (up to 15 min).
      // This unblocks us from Netlify's 10s sync-function timeout, which was
      // killing Cloudbeds syncs that take ~13s to fetch reservation data.
      const res = await fetch(`/api/force-sync?room_id=${f.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })

      if (res.status === 202 || res.status === 200) {
        // Dispatched. Poll sync_logs for completion (background runs async).
        setSyncResults(r => ({ ...r, [f.id]: { ok: null, message: 'Syncing… checking back every 5s' } }))

        const startedAt = new Date().toISOString()
        let resolved = false
        for (let attempt = 0; attempt < 36 && !resolved; attempt++) { // up to 3 min
          await new Promise(r => setTimeout(r, 5000))
          const { data: logs } = await supabase
            .from('sync_logs')
            .select('status, bookings_fetched, bookings_inserted, error_message, created_at')
            .eq('room_id', f.id)
            .gte('created_at', startedAt)
            .order('created_at', { ascending: false })
            .limit(1)
          const log = logs && logs[0]
          if (log && log.status && log.status !== 'running') {
            resolved = true
            if (log.status === 'success') {
              setSyncResults(r => ({
                ...r,
                [f.id]: { ok: true, message: `Synced ${log.bookings_fetched ?? 0} bookings (${log.bookings_inserted ?? 0} new)` },
              }))
              fetchRooms()
            } else {
              setSyncResults(r => ({ ...r, [f.id]: { ok: false, message: log.error_message || 'Sync failed' } }))
            }
          }
        }
        if (!resolved) {
          setSyncResults(r => ({ ...r, [f.id]: { ok: null, message: 'Still running — check Sync Logs page in a minute' } }))
        }
      } else {
        const body = await res.text().catch(() => '')
        setSyncResults(r => ({ ...r, [f.id]: { ok: false, message: `HTTP ${res.status}${body ? `: ${body.slice(0,120)}` : ''}` } }))
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
          <h1 className="page-title">Rooms</h1>
          <p className="page-subtitle">Hotels, Airbnbs, and other rooms connected to Horizon</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Room</button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search rooms…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All types</option>
          <option value="hotel">Hotel</option>
          <option value="airbnb">Airbnb</option>
          <option value="other_max_pax">Other (Max Pax)</option>
        </select>
        <select className="filter-select" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="">All platforms</option>
          <option value="hosthub">HostHub</option>
          <option value="webhotelier">WebHotelier</option>
          <option value="roomrack">RoomRack</option>
          <option value="hotelizer">Hotelizer</option>
          <option value="cloudbeds">Cloudbeds</option>
          <option value="loggia">Loggia</option>
          <option value="other">Manual</option>
        </select>
        <select className="filter-select" value={filterStore} onChange={e => setFilterStore(e.target.value)}>
          <option value="">All stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="result-count">{filtered.length} room{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{search || filterType || filterPlatform || filterStore
            ? 'No rooms match your filters.'
            : 'No rooms yet. Create your first one.'}
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
                <th>ID</th>
                <th>Platform ID</th>
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
                      <span className={`badge badge-type ${f.room_type}`}>{TYPE_LABEL[f.room_type]}</span>
                      <span className={`badge badge-platform ${f.platform}`}>{PLATFORM_LABEL[f.platform]}</span>
                    </td>
                    <td>
                      <CopyChip
                        value={f.id}
                        displayValue={`${f.id.slice(0, 8)}…`}
                        title="Internal Horizon ID — click ⧉ to copy in full"
                      />
                    </td>
                    <td>
                      {f.platform_id ? (
                        <CopyChip value={f.platform_id} title="Platform ID — use this as External Id in GonnaOrder" />
                      ) : f.platform === 'other' ? (
                        <CopyChip
                          value={f.id}
                          displayValue={`${f.id.slice(0, 8)}… (UUID)`}
                          title="No platform integration — use the Horizon UUID as External Id in GonnaOrder"
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="cell-number">{f.max_capacity ?? <span className="muted">—</span>}</td>
                    <td className="cell-date">
                      {f.platform === 'other' ? (
                        <span className="muted">N/A — manual</span>
                      ) : f.last_synced_at ? (
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
                      {f.platform !== 'other' && (
                        <button
                          className={`btn btn-sync btn-sm ${isSyncing ? 'syncing' : ''}`}
                          onClick={() => handleForceSync(f)}
                          disabled={!!syncingId}
                          title="Force sync this room now"
                        >
                          {isSyncing ? '⟳ Syncing…' : '⟳ Sync'}
                        </button>
                      )}
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
        <RoomForm
          room={editTarget}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchRooms() }}
        />
      )}
    </div>
  )
}
