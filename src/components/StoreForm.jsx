import { useState } from 'react'
import { supabase } from '../supabase'

export default function StoreForm({ store, onClose, onSaved }) {
  const isEdit = !!store
  const [form, setForm] = useState({
    name: store?.name || '',
    gonnaorder_store_id: store?.gonnaorder_store_id || '',
    public_link: store?.public_link || '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      gonnaorder_store_id: form.gonnaorder_store_id.trim(),
      public_link: form.public_link.trim() || null,
      updated_at: new Date().toISOString(),
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
      <div className="modal">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Store' : 'New Store'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="field-group">
            <label htmlFor="name">Store Name <span className="required">*</span></label>
            <input
              id="name"
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Sunrise Café"
              required
              autoFocus
            />
          </div>

          <div className="field-group">
            <label htmlFor="gonnaorder_store_id">
              GonnaOrder Store ID <span className="required">*</span>
            </label>
            <input
              id="gonnaorder_store_id"
              type="text"
              value={form.gonnaorder_store_id}
              onChange={e => set('gonnaorder_store_id', e.target.value)}
              placeholder="e.g. sunrise-cafe-athens"
              required
            />
            <p className="field-hint">The unique identifier used by GonnaOrder to reference this store.</p>
          </div>

          <div className="field-group">
            <label htmlFor="public_link">Public Order Link</label>
            <input
              id="public_link"
              type="url"
              value={form.public_link}
              onChange={e => set('public_link', e.target.value)}
              placeholder="https://gonnaorder.com/store/..."
            />
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
