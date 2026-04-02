import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const EMPTY = {
  name: '',
  secondary_name: '',
  facility_type: 'hotel',
  external_id: '',
  platform: 'hosthub',
  max_capacity: '',
  store_id: '',
  location_room_id: '',
}

export default function FacilityForm({ facility, onClose, onSaved }) {
  const isEdit = !!facility
  const [form, setForm] = useState(isEdit ? {
    name: facility.name || '',
    secondary_name: facility.secondary_name || '',
    facility_type: facility.facility_type || 'hotel',
    external_id: facility.external_id || '',
    platform: facility.platform || 'hosthub',
    max_capacity: facility.max_capacity ?? '',
    store_id: facility.store_id || '',
    location_room_id: facility.location_room_id || '',
  } : { ...EMPTY })
  const [stores, setStores] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('stores').select('id, name').order('name').then(({ data }) => {
      setStores(data || [])
    })
  }, [])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      secondary_name: form.secondary_name.trim() || null,
      facility_type: form.facility_type,
      external_id: form.external_id.trim() || null,
      platform: form.platform,
      max_capacity: form.max_capacity !== '' ? Number(form.max_capacity) : null,
      store_id: form.store_id || null,
      location_room_id: form.location_room_id.trim() || null,
      updated_at: new Date().toISOString(),
    }

    let error
    if (isEdit) {
      ;({ error } = await supabase.from('facilities').update(payload).eq('id', facility.id))
    } else {
      ;({ error } = await supabase.from('facilities').insert(payload))
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
          <h2>{isEdit ? 'Edit Facility' : 'New Facility'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* ── Identity ── */}
          <h3 className="form-section-title">Identity</h3>
          <div className="form-grid">
            <div className="field-group span-2">
              <label htmlFor="f-name">Facility Name <span className="required">*</span></label>
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
              <label htmlFor="f-type">Facility Type <span className="required">*</span></label>
              <select id="f-type" value={form.facility_type} onChange={e => set('facility_type', e.target.value)}>
                <option value="hotel">Hotel</option>
                <option value="airbnb">Airbnb</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="f-platform">Platform <span className="required">*</span></label>
              <select id="f-platform" value={form.platform} onChange={e => set('platform', e.target.value)}>
                <option value="hosthub">HostHub</option>
                <option value="webhotelier">WebHotelier</option>
                <option value="other">Other (manual)</option>
              </select>
              {form.platform === 'other' && (
                <p className="field-hint">No API sync — breakfast count equals max capacity every day.</p>
              )}
            </div>
          </div>

          {/* ── Platform ── */}
          {form.platform !== 'other' && (
          <>
          <h3 className="form-section-title">Platform Connection</h3>
          <p className="form-section-hint">
            API credentials are managed at the Store level and shared across all its facilities.
          </p>
          <div className="form-grid">
            <div className="field-group span-2">
              <label htmlFor="f-external-id">Platform ID (External ID)</label>
              <input
                id="f-external-id"
                type="text"
                value={form.external_id}
                onChange={e => set('external_id', e.target.value)}
                placeholder="ID assigned by HostHub or WebHotelier"
              />
              <p className="field-hint">The property ID as it appears in the booking platform (e.g. from the HostHub URL).</p>
            </div>
          </div>
          </>
          )}

          {/* ── Capacity ── */}
          <h3 className="form-section-title">Capacity</h3>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="f-capacity">Max Capacity (guests)</label>
              <input
                id="f-capacity"
                type="number"
                min="1"
                value={form.max_capacity}
                onChange={e => set('max_capacity', e.target.value)}
                placeholder="e.g. 40"
              />
              <p className="field-hint">
                {form.platform === 'other'
                  ? 'Daily breakfast allowance — this many breakfasts are available every day.'
                  : 'Maximum number of guests = maximum breakfasts served.'}
              </p>
            </div>
          </div>

          {/* ── Internal ── */}
          <h3 className="form-section-title">Internal Settings</h3>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="f-store">Linked Store</label>
              <select id="f-store" value={form.store_id} onChange={e => set('store_id', e.target.value)}>
                <option value="">— No store linked —</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p className="field-hint">The GonnaOrder store that serves this facility.</p>
            </div>
            <div className="field-group">
              <label htmlFor="f-room-id">Location / Room ID</label>
              <input
                id="f-room-id"
                type="text"
                value={form.location_room_id}
                onChange={e => set('location_room_id', e.target.value)}
                placeholder="Internal recogniser"
              />
              <p className="field-hint">Used internally to match GonnaOrder location IDs.</p>
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Facility'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
