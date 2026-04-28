// gonnaorderExport.js
//
// Two flows are supported:
//
// 1) Build a fresh Table_Import.xlsx from Horizon rooms (creates rooms in
//    GonnaOrder on upsert). Used for empty test stores where you don't yet
//    have rooms in GonnaOrder.
//
// 2) Mapping flow (production-safe): the operator uploads their current
//    GonnaOrder Table_Import export. We parse it, auto-match by name to
//    Horizon rooms, surface unmatched rows for manual override, and then
//    re-emit the same rows with only the "External Id" column filled in.
//    Because the upsert is keyed on "Table Name or Number *", uploading
//    that file fills External Id on the existing rows without creating
//    duplicates.
import * as XLSX from 'xlsx'

// Ordered headers — must mirror the GonnaOrder template exactly.
export const GO_HEADERS = [
  'Table Name or Number *',
  'Description',
  'Comment',
  'Location Types *',
  'Reservation maximum capacity',
  'Reservation minimum capacity',
  'Reservation priority',
  'Allow customers reservations',
  'External Id',
  'Address Line 1',
  'Address Line 2',
  'Post Code',
  'Region',
  'City',
  'GPS coordinates',
  'Email',
  'Phone Number',
]

export const GO_TABLE_NAME_KEY = 'Table Name or Number *'
export const GO_EXT_ID_KEY     = 'External Id'

// ─── Flow 1: build a fresh Table_Import.xlsx from Horizon rooms ─────────────

function rowForHorizonRoom(room) {
  const comment = room.platform_id
    ? `Horizon ${room.platform || 'room'} · platform_id: ${room.platform_id}`
    : 'Horizon room'
  return {
    [GO_TABLE_NAME_KEY]:               room.name || '',
    'Description':                     room.secondary_name || '',
    'Comment':                         comment,
    'Location Types *':                'LOCATION',
    'Reservation maximum capacity':    room.max_capacity ?? '',
    'Reservation minimum capacity':    '',
    'Reservation priority':            '',
    'Allow customers reservations':    'No',
    [GO_EXT_ID_KEY]:                   room.platform_id || room.id,
    'Address Line 1': '', 'Address Line 2': '', 'Post Code': '', 'Region': '',
    'City': '', 'GPS coordinates': '', 'Email': '', 'Phone Number': '',
  }
}

export function buildFreshGonnaOrderXlsxBuffer(rooms) {
  const rows = rooms.map(rowForHorizonRoom)
  const ws = XLSX.utils.json_to_sheet(rows, { header: GO_HEADERS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Table_Import')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// ─── Flow 2: parse + auto-match + re-emit (mapping flow) ─────────────────────

// Parse an xlsx ArrayBuffer into rows. Each row is an object whose keys are
// the column headers and values are the cell text. Empty cells become ''.
export function parseGonnaOrderXlsx(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  if (!wb.SheetNames.length) return { rows: [], headers: [], sheetName: null }
  // Prefer "Table_Import" if present, else fall back to the first sheet.
  const sheetName = wb.SheetNames.includes('Table_Import') ? 'Table_Import' : wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
  // Capture header order from the first row literal (sheet_to_json doesn't
  // preserve original column order if the first row has nulls — keep
  // GO_HEADERS as a stable baseline and append any extra columns).
  const seen = new Set(GO_HEADERS)
  const extras = []
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); extras.push(k) }
  }
  return { rows, headers: [...GO_HEADERS, ...extras], sheetName }
}

// Normalize a name for matching: trim, collapse whitespace, lowercase.
export function normalizeName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Auto-match GonnaOrder rows to Horizon rooms by normalized name.
// Returns { matches: { [rowIndex]: horizonRoomId | null }, ambiguous: number[] }.
// A match is only set when exactly one Horizon room normalizes to the same
// name — names that map to multiple Horizon rooms are surfaced as ambiguous
// so the operator can disambiguate manually.
export function autoMatch(goRows, horizonRooms) {
  const byName = new Map()
  for (const r of horizonRooms) {
    const n = normalizeName(r.name)
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n).push(r)
  }
  const matches = {}
  const ambiguous = []
  for (let i = 0; i < goRows.length; i++) {
    const goName = goRows[i][GO_TABLE_NAME_KEY]
    if (!goName) { matches[i] = null; continue }
    const candidates = byName.get(normalizeName(goName)) || []
    if (candidates.length === 1) {
      // Store the value that should land in the External Id column —
      // platform_id when present, else the Horizon UUID.
      const c = candidates[0]
      matches[i] = c.platform_id || c.id
    } else {
      matches[i] = null
      if (candidates.length > 1) ambiguous.push(i)
    }
  }
  return { matches, ambiguous }
}

// Build a mapped xlsx ArrayBuffer from the parsed input + the operator's
// final mappings. Preserves all original columns; only updates External Id.
//
// `mappings` is a plain object: { [rowIndex]: horizonRoomId | null | undefined }.
// `options.onlyMapped` (default true) filters out rows with no mapping so the
// generated upsert won't touch unmapped GonnaOrder rooms at all.
export function buildMappedGonnaOrderXlsx(originalRows, originalHeaders, mappings, options = {}) {
  const { onlyMapped = true } = options
  const outRows = []
  for (let i = 0; i < originalRows.length; i++) {
    const hid = mappings[i]
    if (onlyMapped && !hid) continue
    const row = { ...originalRows[i] }
    if (hid) row[GO_EXT_ID_KEY] = hid
    outRows.push(row)
  }
  const headers = (originalHeaders && originalHeaders.length) ? originalHeaders : GO_HEADERS
  const ws = XLSX.utils.json_to_sheet(outRows, { header: headers })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Table_Import')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// ─── Browser helpers ─────────────────────────────────────────────────────────

export function downloadXlsxBuffer(buf, fileName) {
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilenameSegment(s) {
  return (s || 'store')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'store'
}
