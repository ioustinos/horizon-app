import { useState } from 'react'
import { supabase } from '../supabase'

// ---------------------------------------------------------------------------
// Base64-encoded UUID detection
//
// Some clients (or copy-paste tools) deliver API keys base64-encoded. The
// decoded form is what HostHub actually expects. We detect that case so we
// can offer a one-click decode in the form.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64_RE = /^[A-Za-z0-9+/=_-]+$/

function detectBase64EncodedUuid(value) {
  if (!value) return null
  const v = value.trim()
  // Already a plain UUID — nothing to decode.
  if (UUID_RE.test(v)) return null
  // Must look like base64 and have the right length to encode 36 bytes (UUID
  // string with hyphens) — that's 48 base64 chars, no padding needed.
  if (v.length !== 48) return null
  if (!BASE64_RE.test(v)) return null
  try {
    // Convert url-safe base64 to standard before decoding.
    const std = v.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(std)
    if (UUID_RE.test(decoded)) return decoded
  } catch {
    // Not valid base64 — ignore.
  }
  return null
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
                <option value="other">Other (no booking platform)</option>
              </select>
              <p className="field-hint">
                {form.platform === 'webhotelier'
                  ? 'WebHotelier uses Basic Auth (username + password).'
                  : form.platform === 'other'
                  ? 'Rooms will be managed manually — no API sync.'
                  : 'HostHub uses an API key for authentication.'}
              </p>
            </div>
          </div>
          {form.platform !== 'other' && (
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="s-key-name">
                {form.platform === 'webhotelier' ? 'Username / Property Code' : 'API Key Name'}
              </label>
              <input
                id="s-key-name"
                type="text"
                value={form.api_key_name}
                onChange={e => set('api_key_name', e.target.value)}
                placeholder={form.platform === 'webhotelier' ? 'e.g. HRZNTEST' : 'Username / key identifier'}
              />
              {form.platform === 'webhotelier' && (
                <p className="field-hint">This is both the API username and the property code.</p>
              )}
            </div>
            <div className="field-group">
              <label htmlFor="s-key-secret">
                {form.platform === 'webhotelier' ? 'API Password' : 'API Key Secret'}
              </label>
              <input
                id="s-key-secret"
                type="password"
                value={form.api_key_secret}
                onChange={e => set('api_key_secret', e.target.value)}
                placeholder={form.platform === 'webhotelier' ? 'API password' : 'Password / secret key'}
                autoComplete="new-password"
              />
              {form.platform === 'hosthub' && (() => {
                const decoded = detectBase64EncodedUuid(form.api_key_secret)
                if (!decoded) return null
                return (
                  <div
                    role="alert"
                    style={{
                      marginTop: 8,
                      padding: '10px 12px',
                      border: '1px solid #f0c36d',
                      background: '#fff8e1',
                      borderRadius: 6,
                      fontSize: 13,
                      color: '#5c3c00',
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>Looks base64-encoded.</strong> This value decodes to a
                    valid UUID — HostHub expects the decoded form.
                    <div style={{ marginTop: 6, fontFamily: 'monospace', wordBreak: 'break-all', color: '#3d2900' }}>
                      → {decoded}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: 8 }}
                      onClick={() => set('api_key_secret', decoded)}
                    >
                      Decode and use
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
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
