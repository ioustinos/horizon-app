import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'
import StoreForm from '../components/StoreForm'

export default function Stores() {
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  async function fetchStores() {
    setLoading(true)
    const { data, error } = await supabase
      .from('stores')
      .select('*, facilities(id, name)')
      .order('created_at', { ascending: false })
    if (!error) setStores(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchStores() }, [])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return stores
      .filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.gonnaorder_store_id.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const av = (a[sortKey] || '').toString().toLowerCase()
        const bv = (b[sortKey] || '').toString().toLowerCase()
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
  }, [stores, search, sortKey, sortDir])

  function openCreate() { setEditTarget(null); setShowForm(true) }
  function openEdit(store) { setEditTarget(store); setShowForm(true) }

  async function handleDelete(store) {
    if (!confirm(`Delete store "${store.name}"? This cannot be undone.`)) return
    await supabase.from('stores').delete().eq('id', store.id)
    fetchStores()
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="sort-icon">↕</span>
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stores</h1>
          <p className="page-subtitle">GonnaOrder restaurant stores connected to Horizon</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Store</button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search stores…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="result-count">{filtered.length} store{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No stores match your search.' : 'No stores yet. Create your first one.'}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} className="sortable">
                  Store Name <SortIcon col="name" />
                </th>
                <th onClick={() => handleSort('gonnaorder_store_id')} className="sortable">
                  GonnaOrder ID <SortIcon col="gonnaorder_store_id" />
                </th>
                <th>Public Link</th>
                <th>Facilities</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(store => (
                <tr key={store.id}>
                  <td className="cell-primary">{store.name}</td>
                  <td><code className="code-chip">{store.gonnaorder_store_id}</code></td>
                  <td>
                    {store.public_link
                      ? <a href={store.public_link} target="_blank" rel="noreferrer" className="table-link">Open ↗</a>
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    {store.facilities?.length > 0
                      ? <span className="badge">{store.facilities.length} linked</span>
                      : <span className="muted">None</span>}
                  </td>
                  <td className="cell-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(store)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(store)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <StoreForm
          store={editTarget}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchStores() }}
        />
      )}
    </div>
  )
}
