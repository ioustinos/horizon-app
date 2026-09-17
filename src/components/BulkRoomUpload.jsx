import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import {
  buildRoomUploadTemplate,
  parseRoomUploadXlsx,
  buildRoomInsertRows,
  downloadXlsxBuffer,
  safeFilenameSegment,
  PLATFORM_LABEL,
} from '../lib/roomBulkUpload'

const PLATFORM_OPTIONS = ['hosthub', 'webhotelier', 'roomrack', 'hotelizer', 'cloudbeds', 'loggia', 'hostaway', 'orange', 'lodgify', 'other']

export default function BulkRoomUpload({ onClose, onImported }) {
  const [stores, setStores] = useState([])
  const [existingRooms, setExistingRooms] = useState([])
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState('setup') // 'setup' | 'preview' | 'done'
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [manualPlatform, setManualPlatform] = useState('other')
  const [fileError, setFileError] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)

  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [createdCount, setCreatedCount] = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('stores').select('id, name, platform, accommodation_company').order('name'),
      supabase.from('rooms').select('id, name, platform_id'),
    ]).then(([storesRes, roomsRes]) => {
      setStores(storesRes.data || [])
      setExistingRooms(roomsRes.data || [])
      setLoading(false)
    })
  }, [])

  const linkedStore = stores.find(s => s.id === selectedStoreId) || null
  const resolvedPlatform = linkedStore ? linkedStore.platform : manualPlatform
  const resolvedStoreName = linkedStore ? linkedStore.name : null

  function handleDownloadTemplate() {
    const buf = buildRoomUploadTemplate({ storeName: resolvedStoreName, platform: resolvedPlatform })
    downloadXlsxBuffer(buf, `${safeFilenameSegment(resolvedStoreName || 'manual')}_room_upload_template.xlsx`)
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setFileError('')
    setParsing(true)
    try {
      const buf = await file.arrayBuffer()
      const { rows: rawRows } = parseRoomUploadXlsx(buf)
      if (!rawRows.length) throw new Error('No rows found in the "Rooms" sheet of that file.')
      const processed = buildRoomInsertRows(rawRows, {
        storeId: selectedStoreId || null,
        platform: resolvedPlatform,
        existingRooms,
      })
      if (!processed.length) throw new Error('Every row in that file is blank.')
      setRows(processed)
      setSelected(new Set(processed.filter(r => r.status !== 'error').map(r => r.index)))
      setStep('preview')
    } catch (err) {
      setFileError(err.message)
    } finally {
      setParsing(false)
      e.target.value = ''
    }
  }

  function toggleRow(index) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(index)) next.delete(index); else next.add(index)
      return next
    })
  }

  function toggleAll(value) {
    setSelected(value ? new Set(rows.filter(r => r.status !== 'error').map(r => r.index)) : new Set())
  }

  function backToSetup() {
    setStep('setup')
    setRows([])
    setSelected(new Set())
    setFileError('')
    setFileName('')
    setImportError('')
  }

  async function handleImport() {
    setImporting(true)
    setImportError('')
    const payloads = rows
      .filter(r => selected.has(r.index))
      .map(({ name, secondary_name, room_type, platform_id, platform, max_capacity, store_id }) => ({
        name, secondary_name, room_type, platform_id, platform, max_capacity, store_id,
      }))
    const { error } = await supabase.from('rooms').insert(payloads)
    setImporting(false)
    if (error) {
      setImportError(error.message)
    } else {
      setCreatedCount(payloads.length)
      setStep('done')
    }
  }

  const counts = useMemo(() => {
    const c = { ready: 0, warning: 0, error: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])

  const allSelectableChecked = rows.length > 0 &&
    rows.filter(r => r.status !== 'error').every(r => selected.has(r.index)) &&
    rows.some(r => r.status !== 'error')

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: step === 'preview' ? 920 : 680 }}>
        <div className="modal-header">
          <h2>Bulk Upload Rooms</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state"><div className="spinner" /></div>
          ) : step === 'setup' ? (
            <>
              <h3 className="form-section-title">1. Choose store &amp; platform</h3>
              <p className="form-section-hint">
                Every room in one upload shares the same store and platform — pick it once here,
                instead of repeating it on every row.
              </p>
              <div className="form-grid">
                <div className="field-group span-2">
                  <label htmlFor="bu-store">Store</label>
                  <select id="bu-store" value={selectedStoreId} onChange={e => setSelectedStoreId(e.target.value)}>
                    <option value="">— No store (manual rooms) —</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>{s.name}{s.accommodation_company ? ` — ${s.accommodation_company}` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid">
                <div className="field-group span-2">
                  <label>Platform</label>
                  {linkedStore ? (
                    <div>
                      <span className={`badge badge-platform ${resolvedPlatform}`}>{PLATFORM_LABEL[resolvedPlatform]}</span>
                      <p className="field-hint">
                        Inherited from <strong>{linkedStore.name}</strong> — every room created from this
                        file will use this platform.
                      </p>
                    </div>
                  ) : (
                    <>
                      <select value={manualPlatform} onChange={e => setManualPlatform(e.target.value)}>
                        {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
                      </select>
                      <p className="field-hint">No store linked, so pick the platform manually.</p>
                    </>
                  )}
                </div>
              </div>

              <h3 className="form-section-title">2. Download the sample, fill it in</h3>
              <p className="form-section-hint">
                The template's Instructions sheet is tailored to {PLATFORM_LABEL[resolvedPlatform]} and to{' '}
                {resolvedStoreName ? <strong>{resolvedStoreName}</strong> : 'manual rooms'}.
              </p>
              <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
                ⬇ Download Sample Excel
              </button>

              <h3 className="form-section-title" style={{ marginTop: '1.25rem' }}>3. Upload the filled file</h3>
              <div className="form-grid">
                <div className="field-group span-2">
                  <input type="file" accept=".xlsx" onChange={handleFileChange} disabled={parsing} />
                  {parsing && <p className="field-hint">Parsing {fileName}…</p>}
                  {fileError && <p className="form-error">{fileError}</p>}
                </div>
              </div>
            </>
          ) : step === 'preview' ? (
            <>
              <h3 className="form-section-title">Review before importing</h3>
              <p className="form-section-hint">
                {counts.ready} ready · {counts.warning} with warnings (still importable) · {counts.error} with
                errors (won't be imported) — into {resolvedStoreName ? <strong>{resolvedStoreName}</strong> : 'no store'}
                {' '}({PLATFORM_LABEL[resolvedPlatform]}).
              </p>

              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input type="checkbox" checked={allSelectableChecked} onChange={e => toggleAll(e.target.checked)} />
                      </th>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Secondary Name</th>
                      <th>Room Type</th>
                      <th>Platform ID</th>
                      <th>Capacity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.index}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(r.index)}
                            disabled={r.status === 'error'}
                            onChange={() => toggleRow(r.index)}
                          />
                        </td>
                        <td className="muted">{r.index + 2}</td>
                        <td className="cell-primary">{r.name || <span className="muted">—</span>}</td>
                        <td>{r.secondary_name || <span className="muted">—</span>}</td>
                        <td>{r.room_type}</td>
                        <td>{r.platform_id ? <code className="code-chip">{r.platform_id}</code> : <span className="muted">—</span>}</td>
                        <td className="cell-number">{r.max_capacity ?? <span className="muted">—</span>}</td>
                        <td>
                          {r.status === 'ready' && <span className="badge badge-success">Ready</span>}
                          {r.status === 'warning' && <span className="badge badge-warning">Warning</span>}
                          {r.status === 'error' && <span className="badge badge-danger">Error</span>}
                          {r.messages.length > 0 && (
                            <div className="field-hint" style={{ marginTop: 4 }}>{r.messages.join('; ')}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importError && <p className="form-error">{importError}</p>}
            </>
          ) : (
            <div className="empty-state">
              <p>✓ Created {createdCount} room{createdCount === 1 ? '' : 's'}{resolvedStoreName ? ` in ${resolvedStoreName}` : ''}.</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'setup' && (
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          )}
          {step === 'preview' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={backToSetup} disabled={importing}>Back</button>
              <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing || selected.size === 0}>
                {importing ? 'Importing…' : `Import ${selected.size} Room${selected.size === 1 ? '' : 's'}`}
              </button>
            </>
          )}
          {step === 'done' && (
            <button type="button" className="btn btn-primary" onClick={() => { onImported(); onClose() }}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
