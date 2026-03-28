import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'

const STATUS_COLOR = {
  success: 'log-success',
  failed:  'log-failed',
  running: 'log-running',
}

const PROVIDER_LABEL = { hosthub: 'HostHub', webhotelier: 'WebHotelier' }

export default function SyncLogs() {
  const [logs, setLogs]             = useState([])
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState(null)   // log id with expanded error

  // Filters
  const [filterFacility, setFilterFacility] = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')
  const [filterProvider, setFilterProvider] = useState('')

  useEffect(() => {
    supabase.from('facilities').select('id, name').order('name')
      .then(({ data }) => setFacilities(data || []))
  }, [])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('sync_logs')
      .select('*, facilities(id, name, platform)')
      .order('started_at', { ascending: false })
      .limit(200)

    if (filterFacility) query = query.eq('facility_id', filterFacility)
    if (filterStatus)   query = query.eq('status', filterStatus)
    if (filterProvider) query = query.eq('provider', filterProvider)

    const { data, error } = await query
    if (!error) setLogs(data || [])
    setLoading(false)
  }, [filterFacility, filterStatus, filterProvider])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  // Summary stats from visible logs
  const stats = useMemo(() => {
    const total    = logs.length
    const success  = logs.filter(l => l.status === 'success').length
    const failed   = logs.filter(l => l.status === 'failed').length
    const running  = logs.filter(l => l.status === 'running').length
    const fetched  = logs.reduce((s, l) => s + (l.bookings_fetched  || 0), 0)
    const inserted = logs.reduce((s, l) => s + (l.bookings_inserted || 0), 0)
    return { total, success, failed, running, fetched, inserted }
  }, [logs])

  function duration(log) {
    if (!log.completed_at || !log.started_at) return '—'
    const ms = new Date(log.completed_at) - new Date(log.started_at)
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  function fmtTime(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  function timeAgo(ts) {
    if (!ts) return ''
    const seconds = Math.floor((Date.now() - new Date(ts)) / 1000)
    if (seconds < 60)   return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  const hasFilters = filterFacility || filterStatus || filterProvider

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sync Logs</h1>
          <p className="page-subtitle">History of all sync calls to HostHub and WebHotelier</p>
        </div>
        <button className="btn btn-ghost" onClick={fetchLogs}>↻ Refresh</button>
      </div>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total runs</span>
        </div>
        <div className="stat-card" style={{ borderColor: '#86efac' }}>
          <span className="stat-value" style={{ color: '#16a34a' }}>{stats.success}</span>
          <span className="stat-label">Successful</span>
        </div>
        <div className="stat-card" style={{ borderColor: '#fca5a5' }}>
          <span className="stat-value" style={{ color: '#dc2626' }}>{stats.failed}</span>
          <span className="stat-label">Failed</span>
        </div>
        {stats.running > 0 && (
          <div className="stat-card" style={{ borderColor: '#93c5fd' }}>
            <span className="stat-value" style={{ color: '#2563eb' }}>{stats.running}</span>
            <span className="stat-label">Running</span>
          </div>
        )}
        <div className="stat-card">
          <span className="stat-value">{stats.fetched}</span>
          <span className="stat-label">Bookings fetched</span>
        </div>
        <div className="stat-card highlight">
          <span className="stat-value">{stats.inserted}</span>
          <span className="stat-label">Bookings inserted</span>
        </div>
      </div>

      {/* Filters */}
      <div className="toolbar">
        <select className="filter-select" value={filterFacility} onChange={e => setFilterFacility(e.target.value)}>
          <option value="">All facilities</option>
          {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select className="filter-select" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
          <option value="">All platforms</option>
          <option value="hosthub">HostHub</option>
          <option value="webhotelier">WebHotelier</option>
        </select>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setFilterFacility(''); setFilterStatus(''); setFilterProvider('')
          }}>Clear</button>
        )}
        <span className="result-count">{logs.length} log{logs.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <p>{hasFilters ? 'No logs match your filters.' : 'No sync runs yet. Trigger a sync from the Facilities page.'}</p>
        </div>
      ) : (
        <div className="log-list">
          {logs.map(log => (
            <div key={log.id} className={`log-row ${STATUS_COLOR[log.status] || ''}`}>
              <div className="log-main">
                {/* Status pill */}
                <span className={`log-status-pill ${log.status}`}>
                  {log.status === 'running' && <span className="log-spinner" />}
                  {log.status}
                </span>

                {/* Facility + provider */}
                <div className="log-identity">
                  <span className="log-facility">{log.facilities?.name || 'Unknown facility'}</span>
                  <span className={`badge badge-platform ${log.provider}`}>
                    {PROVIDER_LABEL[log.provider] || log.provider}
                  </span>
                </div>

                {/* Timing */}
                <div className="log-timing">
                  <span className="log-time" title={fmtTime(log.started_at)}>
                    {timeAgo(log.started_at)}
                  </span>
                  <span className="log-duration">({duration(log)})</span>
                </div>

                {/* Counts */}
                {log.status !== 'failed' && (
                  <div className="log-counts">
                    <span className="log-count-item" title="Bookings fetched from API">
                      <span className="log-count-icon">↓</span>
                      {log.bookings_fetched ?? 0} fetched
                    </span>
                    <span className="log-count-item" title="New bookings inserted">
                      <span className="log-count-icon new">+</span>
                      {log.bookings_inserted ?? 0} new
                    </span>
                    {(log.bookings_updated ?? 0) > 0 && (
                      <span className="log-count-item" title="Existing bookings updated">
                        <span className="log-count-icon upd">↻</span>
                        {log.bookings_updated} updated
                      </span>
                    )}
                  </div>
                )}

                {/* Error toggle */}
                {log.error_message && (
                  <button
                    className="log-error-toggle"
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    {expanded === log.id ? 'Hide error ▲' : 'Show error ▼'}
                  </button>
                )}
              </div>

              {/* Expanded error */}
              {expanded === log.id && log.error_message && (
                <div className="log-error-body">
                  <pre className="log-error-pre">{log.error_message}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
