import { useState } from 'react'
import { supabase } from '../supabase'

// Dedupe an array of strings, preserving order.
function dedupe(arr) {
  const seen = new Set()
  const out = []
  for (const v of arr) {
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}



export default function StoreForm({ store, onClose, onSaved }) {
  const isEdit = !!store
  const [form, setForm] = useState({
    name:                store?.name || '',
    accommodation_company: store?.accommodation_company || '',
    gonnaorder_store_id: store?.gonnaorder_store_id || '',
    public_link:         store?.public_link || '',
    platform:            store?.platform || 'hosthub',
    api_key_name:        store?.api_key_name || '',
    api_key_secret:      store?.api_key_secret || '',
    // One entry per line in the textarea — joined back to an array on save.
    meal_plan_breakfast_values: Array.isArray(store?.meal_plan_breakfast_values)
      ? store.meal_plan_breakfast_values.join('\n')
      : '',
  })
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      name:                  form.name.trim(),
      accommodation_company: form.accommodation_company.trim() || null,
      gonnaorder_store_id:   form.gonnaorder_store_id.trim(),
      public_link:           form.public_link.trim() || null,
      platform:              form.platform,
      api_key_name:          form.api_key_name.trim() || null,
      api_key_secret:        form.api_key_secret.trim() || null,
      // Convert textarea (one per line) → trimmed, deduped, non-empty string array.
      meal_plan_breakfast_values: dedupe(
        (form.meal_plan_breakfast_values || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean)
      ),
      updated_at:            new Date().toISOString(),
    }

    let error
    if (isEdit) {
      ;({ error } = await supabase.from('stores').update(payload).eq('id', store.id))
    } else {
      ;({ error } = await supabase.from('stores').insert(payload))
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
          <h2>{isEdit ? 'Edit Store' : 'New Store'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">

          {/* ── Identity ── */}
          <h3 className="form-section-title">Identity</h3>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="s-name">GonnaOrder Store Name <span className="required">*</span></label>
              <input
                id="s-name"
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Sunrise Café"
                required
                autoFocus
              />
              <p className="field-hint">The name of the GonnaOrder restaurant store.</p>
            </div>
            <div className="field-group">
              <label htmlFor="s-company">Accommodation Company</label>
              <input
                id="s-company"
                type="text"
                value={form.accommodation_company}
                onChange={e => set('accommodation_company', e.target.value)}
                placeholder="e.g. Sunrise Hospitality Group"
              />
              <p className="field-hint">The hotel or accommodation company that owns the linked rooms.</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="s-go-id">
                GonnaOrder Store ID <span className="required">*</span>
              </label>
              <input
                id="s-go-id"
                type="text"
                value={form.gonnaorder_store_id}
                onChange={e => set('gonnaorder_store_id', e.target.value)}
                placeholder="e.g. sunrise-cafe-athens"
                required
              />
              <p className="field-hint">The unique identifier used by GonnaOrder to reference this store.</p>
            </div>
            <div className="field-group">
              <label htmlFor="s-link">Public Order Link</label>
              <input
                id="s-link"
                type="url"
                value={form.public_link}
                onChange={e => set('public_link', e.target.value)}
                placeholder="https://gonnaorder.com/store/..."
              />
            </div>
          </div>

          {/* ── Platform & API Credentials ── */}
          <h3 className="form-section-title">Platform & API Credentials</h3>
          <p className="form-section-hint">
            The booking platform and account credentials for all rooms linked to this store.
          </p>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="s-platform">Booking Platform <span className="required">*</span></label>
              <select
                id="s-platform"
                value={form.platform}
                onChange={e => set('platform', e.target.value)}
              >
                <option value="hosthub">HostHub</option>
                <option value="webhotelier">WebHotelier</option>
                <option value="roomrack">RoomRack</option>
                <option value="hotelizer">Hotelizer</option>
                <option value="cloudbeds">Cloudbeds</option>
                <option value="other">Other (no booking platform)</option>
              </select>
              <p className="field-hint">
                {form.platform === 'webhotelier'
                  ? 'WebHotelier uses Basic Auth (username + password).'
                  : form.platform === 'roomrack'
                  ? 'RoomRack uses a per-property ApiToken (enable it in the PMS at Setup → Device Interface).'
                  : form.platform === 'hotelizer'
                  ? 'Hotelizer uses Basic Auth (username + password). Public demo: username / pass.'
                  : form.platform === 'cloudbeds'
                  ? 'Cloudbeds uses a per-property API key (cbat_…). Username = the numeric Cloudbeds propertyID; Password = the API key. Generated in Cloudbeds Marketplace → API Credentials.'
                  : form.platform === 'other'
                  ? 'Rooms will be managed manually — no API sync.'
                  : 'HostHub uses an API key for authentication.'}
              </p>
            </div>
          </div>
          {form.platform !== 'other' && (
          <div className="form-grid">
            {form.platform !== 'roomrack' && (
            <div className="field-group">
              <label htmlFor="s-key-name">
                {form.platform === 'webhotelier' ? 'Username / Property Code'
                  : form.platform === 'hotelizer' ? 'Username'
                  : form.platform === 'cloudbeds' ? 'Cloudbeds Property ID'
                  : 'API Key Name'}
              </label>
              <input
                id="s-key-name"
                type="text"
                value={form.api_key_name}
                onChange={e => set('api_key_name', e.target.value)}
                placeholder={form.platform === 'webhotelier' ? 'e.g. HRZNTEST'
                  : form.platform === 'hotelizer' ? 'e.g. username (demo)'
                  : form.platform === 'cloudbeds' ? 'e.g. 320653'
                  : 'Username / key identifier'}
              />
              {form.platform === 'webhotelier' && (
                <p className="field-hint">This is both the API username and the property code.</p>
              )}
              {form.platform === 'hotelizer' && (
                <p className="field-hint">Issued by Hotelizer per property. Demo: <code>username</code>.</p>
              )}
              {form.platform === 'cloudbeds' && (
                <p className="field-hint">The numeric Cloudbeds propertyID — visible in the URL of the property's Cloudbeds admin (e.g. <code>hotels.cloudbeds.com/connect/<strong>320653</strong>/…</code>). Sent as <code>X-PROPERTY-ID</code> on every API call.</p>
              )}
            </div>
            )}
            <div className="field-group">
              <label htmlFor="s-key-secret">
                {form.platform === 'webhotelier' ? 'API Password'
                  : form.platform === 'roomrack' ? 'ApiToken'
                  : form.platform === 'hotelizer' ? 'Password'
                  : form.platform === 'cloudbeds' ? 'Cloudbeds API Key (cbat_…)'
                  : 'API Key Secret'}
              </label>
              <input
                id="s-key-secret"
                type="password"
                value={form.api_key_secret}
                onChange={e => set('api_key_secret', e.target.value)}
                placeholder={form.platform === 'webhotelier' ? 'API password'
                  : form.platform === 'roomrack' ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                  : form.platform === 'hotelizer' ? 'e.g. pass (demo)'
                  : form.platform === 'cloudbeds' ? 'cbat_xxxxxxxxxxxxxxxxxxxx'
                  : 'Password / secret key'}
                autoComplete="new-password"
              />
              {form.platform === 'roomrack' && (
                <p className="field-hint">Per-property token from RoomRack PMS → Setup → Device Interface.</p>
              )}
              {form.platform === 'cloudbeds' && (
                <p className="field-hint">Generated in Cloudbeds Marketplace → API Credentials → Create API Key. Starts with <code>cbat_</code>. Shown only once at creation.</p>
              )}
            </div>
          </div>
          )}

          {form.platform === 'hosthub' && (
            <>
            <h3 className="form-section-title">Breakfast — meal-plan keywords</h3>
            <p className="form-section-hint">
              For HostHub stores: HostHub bookings carry a free-text <code>meal_plan</code> field
              that the host fills in (e.g. <em>"Στην τιμή δωματίου περιλαμβάνεται πρωινό"</em>,
              <em>"BB"</em>, <em>"Half Board"</em>). Add one keyword per line below — a booking is
              treated as breakfast-included when its <code>meal_plan</code> contains
              <strong> any </strong> of these as a substring (case-insensitive).
              Leave blank to keep the legacy default of treating every HostHub booking as
              breakfast-included.
            </p>
            <div className="form-grid">
              <div className="field-group span-2">
                <label htmlFor="s-mealplan">Allowlist</label>
                <textarea
                  id="s-mealplan"
                  rows={4}
                  value={form.meal_plan_breakfast_values}
                  onChange={e => set('meal_plan_breakfast_values', e.target.value)}
                  placeholder={'πρωινό\nbreakfast included\nBB\nHalf Board'}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
                />
                <p className="field-hint">
                  One entry per line. Substring matching is case-insensitive. Be specific enough
                  not to false-match — e.g. <code>BB</code> alone might be too short if other
                  meal_plan strings happen to contain those letters.
                </p>
              </div>
            </div>
            </>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Store'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
