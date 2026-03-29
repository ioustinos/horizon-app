import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'

export default function PullFacilities() {
  const [stores, setStores]         = useState([])
  const [facilities, setFacilities] = useState([])   // all DB facilities
  const [loading, setLoading]       = useState(true)

  // Per-store: { [store_id]: { fetching, error, listings: [...] } }
  const [storeState, setStoreState] = useState({})

  // Per-listing action loading: { [store_id+external_id]: true }
  const [actionLoading, setActionLoading] = useState({})

  // Load stores + existing facilities once
  const loadData = useCallback(async () => {
    setLoading(true)
    const [storesRes, facilitiesRes] = await Promise.all([
      supabase.from('stores').select('id, name, accommodation_company, api_key_name, api_key_secret').order('name'),
      supabase.from('facilities').select('id, name, external_id, platform, store_id, max_capacity, facility_type'),
    ])
    setStores(storesRes.data || [])
    setFacilities(facilitiesRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Build a lookup: external_id → facility (for quick matching)
  const facilityByExternalId = Object.fromEntries(
    facilities.map(f => [f.external_id, f])
  )

  // ── Fetch listings for a store ────────────────────────────────────────────
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

  // ── Add listing as Facility ───────────────────────────────────────────────
  async function addFacility(store, listing) {
    const key = `${store.id}:${listing.external_id}`
    setActionLoading(a => ({ ...a, [key]: true }))
    const { error } = await supabase.from('facilities').insert({
      name:          listing.name,
      facility_type: 'airbnb',
      external_id:   listing.external_id,
      platform:      listing.platform,
      store_id:      store.id,
      unit_count:    1,
      max_capacity:  listing.capacity ?? null,
    })
    setActionLoading(a => ({ ...a, [key]: false }))
    if (error) {
      alert(`Could not create facility: ${error.message}`)
    } else {
      // Refresh facilities list so the UI updates immediately
      const { data } = await supabase.from('facilities').select('id, name, external_id, platform, store_id, max_capacity, facility_type')
      setFacilities(data || [])
    }
  }

  // ── Update facility capacity from listing ─────────────────────────────────
  async function updateFacility(facility, listing) {
    const key = `update:${facility.id}`
    setActionLoading(a => ({ ...a, [key]: true }))
    const { error } = await supabase.from('facilities').update({
      name:         listing.name,
      max_capacity: listing.capacity ?? facility.max_capacity,
      updated_at:   new Date().toISOString(),
    }).eq('id', facility.id)
    setActionLoading(a => ({ ...a, [key]: false }))
    if (error) {
      alert(`Could not update facility: ${error.message}`)
    } else {
      const { data } = await supabase.from('facilities').select('id, name, external_id, platform, store_id, max_capacity, facility_type')
      setFacilities(data || [])
    }
  }

  // ── Delete facility + its bookings ────────────────────────────────────────
  async function deleteFacility(facility) {
    if (!confirm(`Delete facility "${facility.name}" and all its bookings? This cannot be undone.`)) return
    const key = `delete:${facility.id}`
    setActionLoading(a => ({ ...a, [key]: true }))
    // Delete bookings first (no CASCADE on FK), then the facility
    await supabase.from('bookings').delete().eq('facility_id', facility.id)
    const { error } = await supabase.from('facilities').delete().eq('id', facility.id)
    setActionLoading(a => ({ ...a, [key]: false }))
    if (error) {
      alert(`Could not delete facility: ${error.message}`)
    } else {
      const { data } = await supabase.from('facilities').select('id, name, external_id, platform, store_id, max_capacity, facility_type')
      setFacilities(data || [])
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
            Fetch rental listings from the booking platform and onboard them as Horizon facilities
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
                {/* Store header */}
                <div className="pull-store-header">
                  <div className="pull-store-identity">
                    <span className="pull-store-name">{store.name}</span>
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

                {/* Error */}
                {ss.error && (
                  <div className="pull-error">
                    <strong>Error:</strong> {ss.error}
                  </div>
                )}

                {/* Listings table */}
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
                            const existing = facilityByExternalId[listing.external_id]
                            const addKey    = `${store.id}:${listing.external_id}`
                            const updateKey = `update:${existing?.id}`
                            const deleteKey = `delete:${existing?.id}`

                            return (
                              <tr key={listing.external_id}>
                                <td className="cell-primary">{listing.name}</td>
                                <td><code className="code-chip">{listing.external_id}</code></td>
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
                                        onClick={() => updateFacility(existing, listing)}
                                        disabled={!!actionLoading[updateKey]}
                                        title="Sync name and capacity from platform"
                                      >
                                        {actionLoading[updateKey] ? '…' : 'Update'}
                                      </button>
                                      <button
                                        className="btn btn-danger btn-sm"
                                        onClick={() => deleteFacility(existing)}
                                        disabled={!!actionLoading[deleteKey]}
                                      >
                                        {actionLoading[deleteKey] ? '…' : 'Delete'}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn btn-success btn-sm"
                                      onClick={() => addFacility(store, listing)}
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
