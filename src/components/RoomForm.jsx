import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const EMPTY = {
  name: '',
  secondary_name: '',
  room_type: 'hotel',
  platform_id: '',
  platform: 'hosthub',
  max_capacity: '',
  store_id: '',
}

const PLATFORM_LABEL = {
  hosthub: 'HostHub',
  webhotelier: 'WebHotelier',
  roomrack: 'RoomRack',
  hotelizer: 'Hotelizer',
  cloudbeds: 'Cloudbeds',
  loggia: 'Loggia',
  hostaway: 'Hostaway',
  orange: 'Orange PMS',
  lodgify: 'Lodgify',
  other: 'Manual (no platform)',
}

function PlatformOptions() {
  return (
    <>
      <option value="hosthub">HostHub</option>
      <option value="webhotelier">WebHotelier</option>
      <option value="roomrack">RoomRack</option>
      <option value="hotelizer">Hotelizer</option>
      <option value="cloudbeds">Cloudbeds</option>
      <option value="loggia">Loggia</option>
      <option value="hostaway">Hostaway</option>
      <option value="orange">Orange PMS</option>
      <option value="lodgify">Lodgify</option>
      <option value="other">Other (manual)</option>
    </>
  )
}

export default function RoomForm({ room, onClose, onSaved }) {
  const isEdit = !!room
  const [form, setForm] = useState(isEdit ? {
    name: room.name || '',
    secondary_name: room.secondary_name || '',
    room_type: room.room_type || 'hotel',
    platform_id: room.platform_id || '',
    platform: room.platform || 'hosthub',
    max_capacity: room.max_capacity ?? '',
    store_id: room.store_id || '',
  } : { ...EMPTY })
  const [stores, setStores] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Platform is needed here too — selecting a store now drives (inherits)
    // this room's platform, since API credentials live on the store.
    supabase.from('stores').select('id, name, platform').order('name').then(({ data }) => {
      setStores(data || [])
    })
  }, [])

  const isOther = form.room_type === 'other_max_pax'
  const linkedStore = stores.find(s => s.id === form.store_id) || null

  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value }

      if (field === 'room_type') {
        if (value === 'other_max_pax') {
          next.platform = 'other'
          next.platform_id = ''
        } else if (f.room_type === 'other_max_pax') {
          // Leaving "Other (Max Pax)" — fall back to the linked store's
          // platform if there is one, otherwise the old hosthub default.
          const store = stores.find(s => s.id === next.store_id)
          next.platform = store?.platform || 'hosthub'
        }
      }

      // Platform is inherited from the linked store — API credentials are
      // managed at the Store level, so a room's platform must match its
      // store's platform for sync to route to the right provider. Picking
      // (or clearing) a store here keeps that in sync automatically.
      if (field === 'store_id' && next.room_type !== 'other_max_pax') {
        if (value) {
          const store = stores.find(s => s.id === value)
          if (store) next.platform = store.platform
        }
      }

      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      secondary_name: form.secondary_name.trim() || null,
      room_type: form.room_type,
      platform_id: form.platform_id.trim() || null,
      platform: form.platform,
      max_capacity: form.max_capacity !== '' ? Number(form.max_capacity) : null,
      store_id: form.store_id || null,
      updated_at: new Date().toISOString(),
    }

    let error
    if (isEdit) {
      ;({ error } = await supabase.from('rooms').update(payload).eq('id', room.id))
    } else {
      ;({ error } = await supabase.from('rooms').insert(payload))
    }

    if (error) {
      setError(error.message)
      setSaving(false)
    } else {
      onSaved()
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Room' : 'New Room'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* ── Identity ── */}
          <h3 className="form-section-title">Identity</h3>

          {/* Show internal ID when editing */}
          {isEdit && (
            <div className="field-group span-2" style={{ marginBottom: '0.25rem' }}>
              <label>Horizon Room ID</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <code className="code-chip" style={{ fontSize: '0.85rem', padding: '0.35rem 0.65rem' }}>{room.id}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigator.clipboard.writeText(room.id)}
                  title="Copy to clipboard"
                >
                  Copy
                </button>
              </div>
              <p className="field-hint">Internal Horizon reference for support and debugging.</p>
            </div>
          )}

          <div className="form-grid">
            <div className="field-group span-2">
              <label htmlFor="f-name">Room Name <span className="required">*</span></label>
              <input
                id="f-name"
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Sunrise Hotel"
                required
                autoFocus
              />
            </div>
            <div className="field-group span-2">
              <label htmlFor="f-secondary">Secondary Name</label>
              <input
                id="f-secondary"
                type="text"
                value={form.secondary_name}
                onChange={e => set('secondary_name', e.target.value)}
                placeholder="e.g. Owner name for Airbnb"
              />
              <p className="field-hint">Used as an internal recogniser — e.g. the Airbnb owner's name.</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="f-type">Room Type <span className="required">*</span></label>
              <select id="f-type" value={form.room_type} onChange={e => set('room_type', e.target.value)}>
                <option value="hotel">Hotel</option>
                <option value="airbnb">Airbnb</option>
                <option value="other_max_pax">Other (Max Pax)</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="f-store">Linked Store</label>
              <select id="f-store" value={form.store_id} onChange={e => set('store_id', e.target.value)}>
                <option value="">— No store linked —</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p className="field-hint">
                {isOther
                  ? 'The GonnaOrder store that serves this room.'
                  : 'The GonnaOrder store that serves this room. Its Platform is inherited below.'}
              </p>
            </div>
          </div>

          {/* ── Platform ── */}
          {form.platform !== 'other' && (
          <>
          <h3 className="form-section-title">Platform Connection</h3>
          <p className="form-section-hint">
            API credentials are managed at the Store level and shared across all its rooms.
          </p>
          <div className="form-grid">
            <div className="field-group">
              <label>Platform</label>
              {linkedStore ? (
                <div>
                  <span className={`badge badge-platform ${form.platform}`}>{PLATFORM_LABEL[form.platform]}</span>
                  <p className="field-hint">
                    Inherited from <strong>{linkedStore.name}</strong>. To change it, edit that store's
                    Platform &amp; API Credentials — every room linked to it shares the same platform.
                  </p>
                </div>
              ) : (
                <>
                  <select id="f-platform" value={form.platform} onChange={e => set('platform', e.target.value)}>
                    <PlatformOptions />
                  </select>
                  <p className="field-hint">No store linked, so pick the platform manually. Link a store above to have this follow it automatically.</p>
                </>
              )}
            </div>
            <div className="field-group">
              <label htmlFor="f-platform-id">Platform ID</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  id="f-platform-id"
                  type="text"
                  value={form.platform_id}
                  onChange={e => set('platform_id', e.target.value)}
                  placeholder="ID/code from HostHub, WebHotelier, or RoomRack room number"
                  style={{ flex: 1 }}
                />
                {form.platform_id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigator.clipboard.writeText(form.platform_id)}
                    title="Copy Platform ID"
                  >
                    Copy
                  </button>
                )}
              </div>
              <p className="field-hint">The property/room ID as it appears in the booking platform (e.g. the rental ID from the HostHub URL, the room code from WebHotelier, or the room number from RoomRack). <strong>Use this value as the External ID in GonnaOrder</strong> to link this room.</p>
            </div>
          </div>
          </>
          )}

          {form.platform === 'other' && !isOther && (
          <>
          <h3 className="form-section-title">Platform</h3>
          {linkedStore ? (
            <p className="form-section-hint">
              Inherited from <strong>{linkedStore.name}</strong>: {PLATFORM_LABEL.other} — no API sync,
              breakfast count equals max capacity every day.
            </p>
          ) : (
            <div className="form-grid">
              <div className="field-group">
                <label htmlFor="f-platform-manual">Platform</label>
                <select id="f-platform-manual" value={form.platform} onChange={e => set('platform', e.target.value)}>
                  <PlatformOptions />
                </select>
                <p className="field-hint">No store linked, so pick the platform manually. No API sync — breakfast count equals max capacity every day.</p>
              </div>
            </div>
          )}
          </>
          )}

          {form.platform === 'other' && isEdit && (
            <>
            <h3 className="form-section-title">GonnaOrder External ID</h3>
            <p className="form-section-hint">
              This room has no booking-platform integration, so use the Horizon UUID below as
              the External ID on the matching GonnaOrder location.
            </p>
            <div className="form-grid">
              <div className="field-group span-2">
                <label>External ID (Horizon UUID)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <code className="code-chip" style={{ flex: 1, padding: '0.5rem 0.7rem', fontSize: '0.85rem' }}>{room.id}</code>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => navigator.clipboard.writeText(room.id)}
                    title="Copy External ID"
                  >
                    Copy
                  </button>
                </div>
                <p className="field-hint">Paste this value into the External ID field of the matching GonnaOrder table/location.</p>
              </div>
            </div>
            </>
          )}

          {/* ── Capacity ── */}
          <h3 className="form-section-title">Capacity</h3>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="f-capacity">Max Capacity (guests){isOther && <span className="required">*</span>}</label>
              <input
                id="f-capacity"
                type="number"
                min="1"
                value={form.max_capacity}
                onChange={e => set('max_capacity', e.target.value)}
                placeholder="e.g. 40"
                required={isOther}
              />
              <p className="field-hint">
                {isOther || form.platform === 'other'
                  ? 'Daily breakfast allowance — this is the maximum number of breakfasts validated each day.'
                  : 'Maximum number of guests = maximum breakfasts served.'}
              </p>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
