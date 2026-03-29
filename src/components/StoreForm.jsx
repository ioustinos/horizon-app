import { useState } from 'react'
import { supabase } from '../supabase'

export default function StoreForm({ store, onClose, onSaved }) {
  const isEdit = !!store
  const [form, setForm] = useState({
    name:                store?.name || '',
    accommodation_company: store?.accommodation_company || '',
    gonnaorder_store_id: store?.gonnaorder_store_id || '',
    public_link:         store?.public_link || '',
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
              <p className="field-hint">The hotel or accommodation company that owns the linked facilities.</p>
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

          {/* ── API Credentials ── */}
          <h3 className="form-section-title">API Credentials</h3>
          <p className="form-section-hint">
            The booking platform account credentials for all facilities linked to this store.
          </p>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="s-key-name">API Key Name</label>
              <input
                id="s-key-name"
                type="text"
                value={form.api_key_name}
                onChange={e => set('api_key_name', e.target.value)}
                placeholder="Username / key identifier"
              />
            </div>
            <div className="field-group">
              <label htmlFor="s-key-secret">API Key Secret</label>
              <input
                id="s-key-secret"
                type="password"
                value={form.api_key_secret}
                onChange={e => set('api_key_secret', e.target.value)}
                placeholder="Password / secret key"
                autoComplete="new-password"
              />
            </div>
          </div>

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
