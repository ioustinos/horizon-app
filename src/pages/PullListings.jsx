import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'

export default function PullListings() {
  const [stores, setStores]   = useState([])
  const [rooms, setRooms]     = useState([])
  const [loading, setLoading] = useState(true)

  const [storeState, setStoreState] = useState({})
  const [actionLoading, setActionLoading] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    const [storesRes, roomsRes] = await Promise.all([
      supabase.from('stores').select('id, name, accommodation_company, api_key_name, api_key_secret, platform').order('name'),
      supabase.from('rooms').select('id, name, platform_id, platform, store_id, max_capacity, room_type'),
    ])
    setStores(storesRes.data || [])
    setRooms(roomsRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const roomByPlatformId = Object.fromEntries(
    rooms.map(f => [f.platform_id, f])
  )

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
      const { data } = await supabase.from('rooms').select('id, name, platform_id, platform, store_id, max_capacity, room_type')
      setRooms(data || [])
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
      const { data } = await supabase.from('rooms').select('id, name, platform_id, platform, store_id, max_capacity, room_type')
      setRooms(data || [])
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
      const { data } = await supabase.from('rooms').select('id, name, platform_id, platform, store_id, max_capacity, room_type')
      setRooms(data || [])
    }
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
            const hasCredentials = !!store.api_key_secret

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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
