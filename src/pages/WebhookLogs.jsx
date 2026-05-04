// WebhookLogs.jsx — last 200 inbound webhook calls with filters and an
// expandable row that shows the raw request + response JSON.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

const ENDPOINT_OPTIONS = ['/api/validate-breakfast', '/api/after-order']

export default function WebhookLogs() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [filterEndpoint, setFilterEndpoint] = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')
  const [openRowId, setOpenRowId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    let q = supabase
      .from('webhook_logs')
      .select('id, created_at, endpoint, http_method, response_status, duration_ms, request_body, response_body, ip')
      .order('created_at', { ascending: false })
      .limit(200)
    if (filterEndpoint) q = q.eq('endpoint', filterEndpoint)
    if (filterStatus === 'ok')  q = q.gte('response_status', 200).lt('response_status', 300)
    if (filterStatus === '4xx') q = q.gte('response_status', 400).lt('response_status', 500)
    if (filterStatus === '5xx') q = q.gte('response_status', 500)
    q.then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [filterEndpoint, filterStatus, refreshKey])

  const stats = useMemo(() => {
    const total = rows.length
    const ok    = rows.filter(r => r.response_status >= 200 && r.response_status < 300).length
    const err   = rows.filter(r => r.response_status >= 400).length
    return { total, ok, err }
  }, [rows])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Webhook Logs</h1>
          <p className="page-subtitle">
            Every inbound call to <code className="code-chip">/api/*</code> — request payload, response, duration. Last 200 entries.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setRefreshKey(k => k + 1)} title="Reload from server">
          ↻ Refresh
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: '#475569', marginRight: 6 }}>Endpoint</label>
          <select value={filterEndpoint} onChange={e => setFilterEndpoint(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="">All endpoints</option>
            {ENDPOINT_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#475569', marginRight: 6 }}>Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '4px 8px' }}>
            <option value="">All statuses</option>
            <option value="ok">2xx (success)</option>
            <option value="4xx">4xx (client error)</option>
            <option value="5xx">5xx (server error)</option>
          </select>
        </div>
        <span style={{ fontSize: 13, color: '#475569' }}>
          Showing {stats.total} · {stats.ok} ok · {stats.err} errors
        </span>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No webhook calls match these filters.</p></div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>When</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Time</th>
                <th>External Id</th>
                <th>Order UUID</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isOpen = openRowId === r.id
                const reqBody = r.request_body || {}
                const respBody = r.response_body || {}
                const extId = reqBody?.location?.externalId || reqBody?.locationExternalId || null
                const orderUuid = reqBody?.orderUuid || reqBody?.uuid || null
                const valid = respBody?.valid
                const reason = respBody?.reason
                const errMsg = respBody?.error
                const status = r.response_status
                const statusClass = status >= 200 && status < 300 ? 'badge-success'
                                  : status >= 400 && status < 500 ? 'badge-warning'
                                  : status >= 500 ? 'badge-danger' : 'badge-neutral'
                return (
                  <Fragment key={r.id}>
                    <tr style={{ background: isOpen ? '#f8fafc' : undefined, cursor: 'pointer' }}
                        onClick={() => setOpenRowId(isOpen ? null : r.id)}>
                      <td>{isOpen ? '▾' : '▸'}</td>
                      <td><span className="cell-date">{formatTs(r.created_at)}</span></td>
                      <td><code className="code-chip">{r.endpoint}</code></td>
                      <td><span className={`badge ${statusClass}`}>{status ?? '—'}</span></td>
                      <td className="cell-number">{r.duration_ms != null ? `${r.duration_ms} ms` : '—'}</td>
                      <td>{extId ? <code className="code-chip">{extId}</code> : <span className="muted">—</span>}</td>
                      <td>{orderUuid ? <code className="code-chip" title={orderUuid}>{String(orderUuid).slice(0, 8)}…</code> : <span className="muted">—</span>}</td>
                      <td>
                        {valid === true || valid === 'true' ? <span className="badge badge-success">valid</span>
                          : valid === false || valid === 'false' ? <span className="badge badge-warning">{reason || 'invalid'}</span>
                          : errMsg ? <span className="badge badge-danger" title={errMsg}>error</span>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={8} style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '12px 8px' }}>
                            <Pane label="Request body" data={reqBody} />
                            <Pane label="Response body" data={respBody} />
                          </div>
                          <div style={{ padding: '0 8px 8px', fontSize: 12, color: '#64748b' }}>
                            {r.http_method} · {r.ip || 'no ip'} · row id <code className="code-chip">{r.id.slice(0, 8)}</code>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Pane({ label, data }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <pre style={{
        background: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 6,
        fontSize: 12, lineHeight: 1.45, overflow: 'auto', maxHeight: 360, margin: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

function formatTs(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
