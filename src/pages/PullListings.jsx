import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import {
  parseGonnaOrderXlsx,
  autoMatch,
  buildMappedGonnaOrderXlsx,
  buildFreshGonnaOrderXlsxBuffer,
  downloadXlsxBuffer,
  safeFilenameSegment,
  GO_TABLE_NAME_KEY,
  GO_EXT_ID_KEY,
} from '../lib/gonnaorderExport'

export default function PullListings() {
  const [stores, setStores]   = useState([])
  const [rooms, setRooms]     = useState([])
  const [loading, setLoading] = useState(true)

  const [storeState, setStoreState] = useState({})
  const [actionLoading, setActionLoading] = useState({})
  const [mapState, setMapState] = useState({}) // per-store mapping state

  const loadData = useCallback(async () => {
    setLoading(true)
    const [storesRes, roomsRes] = await Promise.all([
      supabase.from('stores').select('id, name, accommodation_company, api_key_name, api_key_secret, platform').order('name'),
      supabase.from('rooms').select('id, name, secondary_name, platform_id, platform, store_id, max_capacity, room_type'),
    ])
    setStores(storesRes.data || [])
    setRooms(roomsRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const roomByPlatformId = Object.fromEntries(
    rooms.map(f => [f.platform_id, f])
  )

  const roomsByStore = useMemo(() => {
    const m = {}
    for (const r of rooms) {
      if (!m[r.store_id]) m[r.store_id] = []
      m[r.store_id].push(r)
    }
    return m
  }, [rooms])

  // ── Listings actions ─────────────────────────────────────────────────────

  async function fetchListings(store) {
    setStoreState(s => ({ ...s, [store.id]: { fetching: true, error: null, listings: null } }))
    try {
      const res = await fetch(`/api/fetch-listings?store_id=${store.id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Unknown error')
      setStoreState(s => ({ ...s, [store.id]: { fetching: false, error: null, listings: json.listings } }))
    } catch (err) {
      setStoreState(s => ({ ...s, [store.id]: { fetching: false, error: err.message, listings: null } }))
    }
  }

  async function addRoom(store, listing) {
    const key = `${store.id}:${listing.platform_id}`
    setActionLoading(a => ({ ...a, [key]: true }))
    const isWebHotelier = listing.platform === 'webhotelier'
    const { error } = await supabase.from('rooms').insert({
      name:         listing.name,
      room_type:    isWebHotelier ? 'hotel' : 'airbnb',
      platform_id:  listing.platform_id,
      platform:     listing.platform,
      store_id:     store.id,
      max_capacity: listing.capacity ?? null,
    })
    setActionLoading(a => ({ ...a, [key]: false }))
    if (error) {
      alert(`Could not create room: ${error.message}`)
    } else {
      await reloadRooms()
    }
  }

  async function updateRoom(room, listing) {
    const key = `update:${room.id}`
    setActionLoading(a => ({ ...a, [key]: true }))
    const { error } = await supabase.from('rooms').update({
      name:         listing.name,
      max_capacity: listing.capacity ?? room.max_capacity,
      updated_at:   new Date().toISOString(),
    }).eq('id', room.id)
    setActionLoading(a => ({ ...a, [key]: false }))
    if (error) {
      alert(`Could not update room: ${error.message}`)
    } else {
      await reloadRooms()
    }
  }

  async function deleteRoom(room) {
    if (!confirm(`Delete room "${room.name}" and all its bookings? This cannot be undone.`)) return
    const key = `delete:${room.id}`
    setActionLoading(a => ({ ...a, [key]: true }))
    await supabase.from('bookings').delete().eq('room_id', room.id)
    const { error } = await supabase.from('rooms').delete().eq('id', room.id)
    setActionLoading(a => ({ ...a, [key]: false }))
    if (error) {
      alert(`Could not delete room: ${error.message}`)
    } else {
      await reloadRooms()
    }
  }

  async function reloadRooms() {
    const { data } = await supabase.from('rooms').select('id, name, secondary_name, platform_id, platform, store_id, max_capacity, room_type')
    setRooms(data || [])
  }

  // ── GonnaOrder mapping flow ──────────────────────────────────────────────

  function toggleMapping(storeId) {
    setMapState(s => ({
      ...s,
      [storeId]: { ...(s[storeId] || {}), open: !(s[storeId]?.open) }
    }))
  }

  async function handleMapFile(store, file) {
    if (!file) return
    setMapState(s => ({ ...s, [store.id]: { ...(s[store.id] || {}), open: true, parsing: true, fileError: null } }))
    try {
      const buf = await file.arrayBuffer()
      const { rows, headers } = parseGonnaOrderXlsx(buf)
      if (!rows.length) throw new Error('No rows found in the uploaded xlsx.')
      const horizonRooms = roomsByStore[store.id] || []
      const { matches } = autoMatch(rows, horizonRooms)
      const autoCount = Object.values(matches).filter(Boolean).length
      setMapState(s => ({
        ...s,
        [store.id]: {
          open: true,
          parsing: false,
          fileName: file.name,
          rows,
          headers,
          mappings: matches,
          autoCount,
          totalRows: rows.length,
          fileError: null,
        }
      }))
    } catch (err) {
      setMapState(s => ({
        ...s,
        [store.id]: { ...(s[store.id] || {}), open: true, parsing: false, fileError: err.message }
      }))
    }
  }

  function setManualMapping(storeId, rowIdx, horizonRoomId) {
    setMapState(s => {
      const cur = s[storeId] || {}
      const newMappings = { ...(cur.mappings || {}), [rowIdx]: horizonRoomId || null }
      const autoCount = Object.values(newMappings).filter(Boolean).length
      return { ...s, [storeId]: { ...cur, mappings: newMappings, autoCount } }
    })
  }

  function clearMapping(storeId) {
    setMapState(s => ({ ...s, [storeId]: { open: true } }))
  }

  function downloadMappedFile(store) {
    const ms = mapState[store.id]
    if (!ms?.rows) return
    const buf = buildMappedGonnaOrderXlsx(ms.rows, ms.headers, ms.mappings || {}, { onlyMapped: true })
    const stamp = new Date().toISOString().slice(0, 10)
    downloadXlsxBuffer(buf, `${safeFilenameSegment(store.name)}_gonnaorder_external_ids_${stamp}.xlsx`)
  }

  function downloadFreshFile(store) {
    const list = roomsByStore[store.id] || []
    if (!list.length) {
      alert('No Horizon rooms exist for this store yet. Fetch listings and onboard them first.')
      return
    }
    const buf = buildFreshGonnaOrderXlsxBuffer(list)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadXlsxBuffer(buf, `${safeFilenameSegment(store.name)}_gonnaorder_create_${stamp}.xlsx`)
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state"><div className="spinner" /></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pull Listings</h1>
          <p className="page-subtitle">
            Fetch rental listings from the booking platform and onboard them as Horizon rooms
          </p>
        </div>
      </div>

      {stores.length === 0 ? (
        <div className="empty-state">
          <p>No stores found. Create a store first and add API credentials to it.</p>
        </div>
      ) : (
        <div className="pull-store-list">
          {stores.map(store => {
            const ss = storeState[store.id] || {}
            const ms = mapState[store.id] || {}
            const hasCredentials = !!store.api_key_secret
            const storeRoomCount = (roomsByStore[store.id] || []).length

            return (
              <div key={store.id} className="pull-store-card">
                <div className="pull-store-header">
                  <div className="pull-store-identity">
                    <span className="pull-store-name">{store.name}</span>
                    <span className={`badge ${store.platform === 'webhotelier' ? 'badge-info' : 'badge-neutral'}`} style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                      {store.platform === 'webhotelier' ? 'WebHotelier' : 'HostHub'}
                    </span>
                    {store.accommodation_company && (
                      <span className="pull-store-company">{store.accommodation_company}</span>
                    )}
                  </div>
                  <div className="pull-store-actions">
                    {!hasCredentials && (
                      <span className="inline-warning">No API credentials — set them in Stores</span>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => fetchListings(store)}
                      disabled={!hasCredentials || ss.fetching}
                    >
                      {ss.fetching ? <><span className="btn-spinner" /> Fetching…</> : 'Fetch Listings'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggleMapping(store.id)}
                      disabled={storeRoomCount === 0}
                      title={storeRoomCount === 0
                        ? 'No Horizon rooms onboarded yet — fetch listings first'
                        : 'Map Horizon rooms onto your existing GonnaOrder rooms'}
                    >
                      {ms.open ? 'Hide GonnaOrder mapping' : `Map to GonnaOrder${storeRoomCount > 0 ? ` (${storeRoomCount})` : ''}`}
                    </button>
                  </div>
                </div>

                {ss.error && (
                  <div className="pull-error">
                    <strong>Error:</strong> {ss.error}
                  </div>
                )}

                {ss.listings && (
                  ss.listings.length === 0 ? (
                    <p className="pull-empty">No listings found for this account.</p>
                  ) : (
                    <div className="table-wrapper" style={{ marginTop: '0.75rem' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Listing Name</th>
                            <th>Platform ID</th>
                            <th>Capacity</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ss.listings.map(listing => {
                            const existing = roomByPlatformId[listing.platform_id]
                            const addKey    = `${store.id}:${listing.platform_id}`
                            const updateKey = `update:${existing?.id}`
                            const deleteKey = `delete:${existing?.id}`

                            return (
                              <tr key={listing.platform_id}>
                                <td className="cell-primary">{listing.name}</td>
                                <td><code className="code-chip">{listing.platform_id}</code></td>
                                <td>
                                  {listing.capacity != null
                                    ? <span>{listing.capacity} guests</span>
                                    : <span className="muted">—</span>}
                                </td>
                                <td>
                                  {existing
                                    ? <span className="badge badge-success">In Horizon</span>
                                    : <span className="badge badge-neutral">Not added</span>}
                                </td>
                                <td className="cell-actions">
                                  {existing ? (
                                    <>
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => updateRoom(existing, listing)}
                                        disabled={!!actionLoading[updateKey]}
                                        title="Sync name and capacity from platform"
                                      >
                                        {actionLoading[updateKey] ? '…' : 'Update'}
                                      </button>
                                      <button
                                        className="btn btn-danger btn-sm"
                                        onClick={() => deleteRoom(existing)}
                                        disabled={!!actionLoading[deleteKey]}
                                      >
                                        {actionLoading[deleteKey] ? '…' : 'Delete'}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn btn-success btn-sm"
                                      onClick={() => addRoom(store, listing)}
                                      disabled={!!actionLoading[addKey]}
                                    >
                                      {actionLoading[addKey]
                                        ? '…'
                                        : '+ Serve breakfast to this listing'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {ms.open && (
                  <MappingSection
                    store={store}
                    horizonRooms={roomsByStore[store.id] || []}
                    state={ms}
                    onUpload={file => handleMapFile(store, file)}
                    onSetMapping={(rowIdx, hid) => setManualMapping(store.id, rowIdx, hid)}
                    onClear={() => clearMapping(store.id)}
                    onDownload={() => downloadMappedFile(store)}
                    onDownloadFresh={() => downloadFreshFile(store)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Mapping section component ─────────────────────────────────────────────

function MappingSection({ store, horizonRooms, state, onUpload, onSetMapping, onClear, onDownload, onDownloadFresh }) {
  const { rows, headers, mappings, fileError, parsing, fileName, totalRows, autoCount } = state
  const hasRows = !!(rows && rows.length)
  const mappedCount = mappings ? Object.values(mappings).filter(Boolean).length : 0
  const usedHorizonIds = new Set(Object.values(mappings || {}).filter(Boolean))

  return (
    <div style={{
      marginTop: '0.75rem',
      padding: '0.875rem 1rem',
      border: '1px solid #d6dde8',
      borderRadius: 8,
      background: '#f7f9fc',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>GonnaOrder Mapping</strong>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#566' }}>
            Upload your current GonnaOrder Table_Import export. We&rsquo;ll match rows by name to Horizon
            rooms in <em>{store.name}</em>; you can adjust any unmatched rows manually. The download fills
            in <code>External Id</code> on the rows you&rsquo;ve mapped — unmapped rows are skipped, so
            no new GonnaOrder rooms are created.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={onDownloadFresh}
                  title="Generate a fresh Table_Import.xlsx that CREATES rooms in GonnaOrder. Use only on empty test stores.">
            Create-mode XLSX (test only)
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
          {parsing ? 'Parsing…' : (hasRows ? 'Replace file' : 'Upload current GonnaOrder export')}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={e => onUpload(e.target.files?.[0])}
          />
        </label>
        {fileName && <span style={{ fontSize: 13, color: '#445' }}>📄 <code>{fileName}</code></span>}
        {hasRows && (
          <span style={{ fontSize: 13 }}>
            <span style={{ color: '#0a7d3e' }}>✓ {mappedCount}</span> mapped
            <span style={{ color: '#777' }}> · {totalRows - mappedCount} unmapped</span>
            <span style={{ color: '#777' }}> · auto-matched on upload: {autoCount ?? 0}</span>
          </span>
        )}
        {hasRows && (
          <button className="btn btn-ghost btn-sm" onClick={onClear} title="Clear the uploaded file">
            Reset
          </button>
        )}
      </div>

      {fileError && (
        <div className="pull-error" style={{ marginTop: 8 }}>
          <strong>Error parsing file:</strong> {fileError}
        </div>
      )}

      {hasRows && (
        <>
          <div className="table-wrapper" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>GonnaOrder Table Name</th>
                  <th>Current External Id</th>
                  <th>Mapped Horizon room</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const goName = row[GO_TABLE_NAME_KEY] || ''
                  const currentExt = row[GO_EXT_ID_KEY] || ''
                  const mappedId = mappings?.[i] || ''
                  const matched = !!mappedId
                  return (
                    <tr key={i} style={{ background: matched ? '#f0f9f3' : undefined }}>
                      <td className="cell-primary">{goName || <span className="muted">(empty name)</span>}</td>
                      <td>
                        {currentExt
                          ? <code className="code-chip">{currentExt}</code>
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        <select
                          value={mappedId}
                          onChange={e => onSetMapping(i, e.target.value)}
                          style={{ padding: '4px 6px', fontSize: 13, minWidth: 240 }}
                        >
                          <option value="">— not mapped —</option>
                          {horizonRooms.map(hr => {
                            const taken = usedHorizonIds.has(hr.id) && hr.id !== mappedId
                            return (
                              <option key={hr.id} value={hr.id} disabled={taken}>
                                {hr.name}{hr.secondary_name ? ` — ${hr.secondary_name}` : ''}
                                {taken ? ' (already mapped)' : ''}
                              </option>
                            )
                          })}
                        </select>
                      </td>
                      <td>
                        {matched
                          ? <span className="badge badge-success">Will fill External Id</span>
                          : <span className="badge badge-neutral">Skipped</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={onDownload}
              disabled={mappedCount === 0}
              title={mappedCount === 0
                ? 'Map at least one row before downloading'
                : `Download an upsert-safe xlsx for ${mappedCount} row${mappedCount === 1 ? '' : 's'} — only fills External Id, never creates`}
            >
              Download mapped XLSX ({mappedCount})
            </button>
          </div>
        </>
      )}
    </div>
  )
}
