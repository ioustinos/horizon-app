import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

const SETTING_META = {
  sync_interval_minutes: {
    label: 'Sync Interval',
    unit: 'minutes',
    type: 'number',
    min: 5,
    hint: 'How often each facility is synced with its booking platform. The scheduled job runs every 5 minutes and checks this value — facilities synced more recently than this interval are skipped.',
  },
  sync_lookback_days: {
    label: 'Lookback Window',
    unit: 'days',
    type: 'number',
    min: 1,
    hint: 'How many days back to fetch bookings during each sync. Useful for catching late cancellations.',
  },
  sync_forward_days: {
    label: 'Forward Window',
    unit: 'days',
    type: 'number',
    min: 1,
    hint: 'How many days ahead to fetch upcoming bookings during each sync.',
  },
}

export default function Settings() {
  const [settings, setSettings] = useState({})
  const [dirty, setDirty]       = useState({})
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    supabase.from('settings').select('*').order('key').then(({ data }) => {
      const map = {}
      ;(data || []).forEach(r => { map[r.key] = r.value })
      setSettings(map)
      setLoading(false)
    })
  }, [])

  function handleChange(key, value) {
    setSettings(s => ({ ...s, [key]: value }))
    setDirty(d => ({ ...d, [key]: true }))
    setSaved(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)

    const updates = Object.entries(settings).map(([key, value]) =>
      supabase.from('settings').update({
        value: String(value),
        updated_at: new Date().toISOString(),
      }).eq('key', key)
    )

    const results = await Promise.all(updates)
    const errs = results.filter(r => r.error)

    if (errs.length) {
      setError(errs[0].error.message)
    } else {
      setDirty({})
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  const hasDirty = Object.keys(dirty).length > 0

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure how Horizon syncs and validates bookings</p>
        </div>
        {hasDirty && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : (
        <form onSubmit={handleSave}>
          <div className="settings-section">
            <div className="settings-section-header">
              <h2 className="settings-section-title">Sync Configuration</h2>
              <p className="settings-section-desc">
                Controls how frequently bookings are fetched from HostHub and WebHotelier.
                The sync job runs every 5 minutes and uses these values to decide what to fetch.
              </p>
            </div>

            <div className="settings-cards">
              {Object.entries(SETTING_META).map(([key, meta]) => (
                <div key={key} className="settings-card">
                  <div className="settings-card-label">
                    <label htmlFor={`setting-${key}`}>{meta.label}</label>
                    <span className="settings-unit">{meta.unit}</span>
                  </div>
                  <div className="settings-input-row">
                    <input
                      id={`setting-${key}`}
                      type={meta.type}
                      min={meta.min}
                      value={settings[key] ?? ''}
                      onChange={e => handleChange(key, e.target.value)}
                      className={`settings-input ${dirty[key] ? 'is-dirty' : ''}`}
                    />
                  </div>
                  <p className="field-hint">{meta.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          {saved && (
            <div className="save-banner">
              ✓ Settings saved successfully.
            </div>
          )}

          <div className="settings-footer">
            <button type="submit" className="btn btn-primary" disabled={saving || !hasDirty}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            {!hasDirty && !saved && (
              <span className="muted" style={{ fontSize: '.8125rem' }}>No unsaved changes.</span>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
