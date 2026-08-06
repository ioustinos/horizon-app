import { Fragment, useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'

// Guest Messages — every WhatsApp/SMS message sent to (or received from) a
// guest phone via Twilio. 'dry_run' rows mean the audience logic selected the
// guest but Twilio isn't configured yet, so nothing was actually sent.

const TEMPLATE_LABEL = {
  breakfast_reminder: 'Breakfast reminder',
  review_request:     'Review request',
  session:            'Session reply',
  sms_fallback:       'SMS fallback',
  inbound:            'Inbound',
}

const STATUS_CLASS = {
  delivered: 'badge-success',
  read:      'badge-success',
  received:  'badge-success',
  sent:      'badge-info',
  queued:    'badge-info',
  accepted:  'badge-info',
  dry_run:   'badge-neutral',
  skipped:   'badge-neutral',
  failed:      'badge-status cancelled',
  undelivered: 'badge-status cancelled',
}

export default function GuestMessages() {
  const [messages, setMessages] = useState([])
  const [stores, setStores]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(null)

  const [filterStore,    setFilterStore]    = useState('')
  const [filterTemplate, setFilterTemplate] = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')

  useEffect(() => {
    supabase.from('stores').select('id, name').order('name')
      .then(({ data }) => setStores(data || []))
  }, [])

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('guest_messages')
      .select('*, stores(id, name)')
      .order('sent_at', { ascending: false })
      .limit(200)

    if (filterStore)    query = query.eq('store_id', filterStore)
    if (filterTemplate) query = query.eq('template', filterTemplate)
    if (filterStatus)   query = query.eq('status', filterStatus)

    const { data, error } = await query
    if (!error) setMessages(data || [])
    setLoading(false)
  }, [filterStore, filterTemplate, filterStatus])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const stats = useMemo(() => ({
    total:     messages.length,
    delivered: messages.filter(m => ['delivered', 'read'].includes(m.status)).length,
    failed:    messages.filter(m => ['failed', 'undelivered'].includes(m.status)).length,
    dryRun:    messages.filter(m => m.status === 'dry_run').length,
    inbound:   messages.filter(m => m.direction === 'inbound').length,
  }), [messages])

  function fmtTime(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Guest Messages</h1>
          <p className="page-subtitle">WhatsApp &amp; SMS messages sent to guests — reminders, review requests, replies</p>
        </div>
        <button className="btn btn-ghost" onClick={fetchMessages}>↻ Refresh</button>
      </div>

      <div className="stats-bar">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Messages</span>
        </div>
        <div className="stat-card" style={{ borderColor: '#86efac' }}>
          <span className="stat-value" style={{ color: '#16a34a' }}>{stats.delivered}</span>
          <span className="stat-label">Delivered / read</span>
        </div>
        <div className="stat-card" style={{ borderColor: '#fca5a5' }}>
          <span className="stat-value" style={{ color: '#dc2626' }}>{stats.failed}</span>
          <span className="stat-label">Failed</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.dryRun}</span>
          <span className="stat-label">Dry-run</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.inbound}</span>
          <span className="stat-label">Inbound</span>
        </div>
      </div>

      <div className="toolbar">
        <select className="filter-select" value={filterStore} onChange={e => setFilterStore(e.target.value)}>
          <option value="">All stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="filter-select" value={filterTemplate} onChange={e => setFilterTemplate(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TEMPLATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['dry_run', 'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'received'].map(s =>
            <option key={s} value={s}>{s}</option>
          )}
        </select>
        {(filterStore || filterTemplate || filterStatus) && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setFilterStore(''); setFilterTemplate(''); setFilterStatus('')
          }}>Clear</button>
        )}
      </div>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="empty-state">
          No messages yet. The hourly job logs dry-run rows here once a store has
          messaging enabled — real sends start when Twilio is configured.
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Store</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Channel</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {messages.map(m => (
                <Fragment key={m.id}>
                  <tr>
                    <td>{fmtTime(m.sent_at)}</td>
                    <td>{m.stores?.name || '—'}</td>
                    <td>{m.direction === 'inbound' ? '← ' : ''}{m.phone}</td>
                    <td>{TEMPLATE_LABEL[m.template] || m.template}</td>
                    <td>{m.channel}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[m.status] || 'badge-neutral'}`}>
                        {m.status}{m.error_code ? ` (${m.error_code})` : ''}
                      </span>
                    </td>
                    <td>
                      {(m.body || m.meta) && (
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                          {expanded === m.id ? 'Hide' : 'Details'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === m.id && (
                    <tr>
                      <td colSpan={7}>
                        {m.body && <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 .5rem' }}>{m.body}</p>}
                        {m.meta && (
                          <pre style={{ fontSize: '.75rem', overflow: 'auto', margin: 0 }}>
                            {JSON.stringify(m.meta, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
