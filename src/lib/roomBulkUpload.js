// roomBulkUpload.js
//
// Bulk room upload: generate a sample Excel template pre-filled for one
// selected Store (so Platform doesn't need a column — it's fixed for the
// whole file, same as how a room's platform is inherited from its store
// everywhere else in Horizon), parse a filled-in file back, and validate
// each row into an insert-ready payload with a per-row status.
import * as XLSX from 'xlsx'

export const ROOM_NAME_KEY      = 'Room Name *'
export const SECONDARY_NAME_KEY = 'Secondary Name'
export const ROOM_TYPE_KEY      = 'Room Type * (hotel / airbnb / other_max_pax)'
export const PLATFORM_ID_KEY    = 'Platform ID'
export const MAX_CAPACITY_KEY   = 'Max Capacity (guests)'

export const ROOM_HEADERS = [
  ROOM_NAME_KEY,
  SECONDARY_NAME_KEY,
  ROOM_TYPE_KEY,
  PLATFORM_ID_KEY,
  MAX_CAPACITY_KEY,
]

export const PLATFORM_LABEL = {
  hosthub: 'HostHub',
  webhotelier: 'WebHotelier',
  roomrack: 'RoomRack',
  hotelizer: 'Hotelizer',
  cloudbeds: 'Cloudbeds',
  loggia: 'Loggia',
  hostaway: 'Hostaway',
  orange: 'Orange PMS',
  lodgify: 'Lodgify',
  other: 'Manual (no platform)',
}

// Same per-platform guidance shown in StoreForm/RoomForm, adapted for the
// template's Instructions sheet.
export const PLATFORM_ID_HINT = {
  hosthub: 'the HostHub rental ID (found in the HostHub URL for that listing). Leave blank if you don\'t have it yet.',
  webhotelier: 'the WebHotelier room CODE.',
  roomrack: 'the RoomRack room number (matches RoomRack\'s "Room Number").',
  hotelizer: 'the Hotelizer accommodation/room code (from board_types / accommodations).',
  cloudbeds: 'the Cloudbeds room name (e.g. "101", "Suite A") — matches what Cloudbeds calls the room, not its internal roomID.',
  loggia: 'the Loggia property id.',
  hostaway: 'the Hostaway listing id (a unique integer, from the Hostaway listing).',
  orange: 'the Orange PMS RoomNumber.',
  lodgify: 'the Lodgify propertyId:roomTypeId pair (e.g. "12345:67890") — Lodgify identifies room TYPES, not physical units.',
  other: 'not used — this store has no platform integration, so leave Platform ID blank on every row.',
}

const ROOM_TYPE_ALIASES = {
  hotel: 'hotel',
  airbnb: 'airbnb',
  other: 'other_max_pax',
  other_max_pax: 'other_max_pax',
  'other (max pax)': 'other_max_pax',
  'other max pax': 'other_max_pax',
}

// ─── Template generation ────────────────────────────────────────────────────

export function buildRoomUploadTemplate({ storeName, platform }) {
  const platformLabel = PLATFORM_LABEL[platform] || platform

  const instructions = [
    ['Horizon — Bulk Room Upload'],
    [''],
    ['Store', storeName || '(no store — manual rooms)'],
    ['Platform', platformLabel],
    [''],
    ['How to fill this in'],
    ['1. Fill one row per room in the "Rooms" sheet. Every room created from this file will be linked to the store and platform shown above — do not add Store or Platform columns.'],
    ['2. Room Name is required.'],
    ['3. Room Type must be one of: hotel, airbnb, other_max_pax. Leave blank to default to "hotel".'],
    [`4. Platform ID: ${PLATFORM_ID_HINT[platform] || 'the ID/code for this room on the platform above.'}`],
    ['5. Max Capacity (guests) = maximum breakfasts served per day. Required for "other_max_pax" rooms (it becomes the daily breakfast allowance); optional otherwise.'],
    [''],
    ['Save this file and upload it back in Horizon → Rooms → Bulk Upload.'],
  ]

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructions)
  wsInstructions['!cols'] = [{ wch: 100 }]

  const wsRooms = XLSX.utils.aoa_to_sheet([ROOM_HEADERS])
  wsRooms['!cols'] = ROOM_HEADERS.map(h =>
    h === ROOM_TYPE_KEY ? { wch: 34 } : h === ROOM_NAME_KEY || h === SECONDARY_NAME_KEY ? { wch: 26 } : { wch: 18 }
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')
  XLSX.utils.book_append_sheet(wb, wsRooms, 'Rooms')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export function parseRoomUploadXlsx(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  if (!wb.SheetNames.length) return { rows: [], sheetName: null }
  const sheetName =
    wb.SheetNames.find(n => n === 'Rooms') ||
    wb.SheetNames.find(n => n !== 'Instructions') ||
    wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
  return { rows, sheetName }
}

// ─── Validation / normalization ─────────────────────────────────────────────

function normalizeRoomType(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return { value: 'hotel', defaulted: true }
  const mapped = ROOM_TYPE_ALIASES[s]
  if (mapped) return { value: mapped, defaulted: false }
  return { value: null, defaulted: false }
}

function isBlankRow(row) {
  return [ROOM_NAME_KEY, SECONDARY_NAME_KEY, ROOM_TYPE_KEY, PLATFORM_ID_KEY, MAX_CAPACITY_KEY]
    .every(k => String(row[k] ?? '').trim() === '')
}

// Turns parsed sheet rows into insert-ready payloads with a status:
// 'ready' | 'warning' | 'error'. `platform` is the batch's resolved platform
// (the linked store's platform, or the manually-picked one when no store is
// linked) — every row shares it, mirroring how a room's platform is
// inherited from its store elsewhere in the app.
export function buildRoomInsertRows(rawRows, { storeId, platform, existingRooms = [] }) {
  const kept = rawRows.filter(r => !isBlankRow(r))

  const results = kept.map((row, i) => {
    const messages = []
    let status = 'ready'
    const bump = (level) => { if (level === 'error' || status !== 'error') status = level === 'error' ? 'error' : (status === 'ready' ? level : status) }

    const name = String(row[ROOM_NAME_KEY] ?? '').trim()
    if (!name) { messages.push('Room Name is required'); bump('error') }

    const secondary_name = String(row[SECONDARY_NAME_KEY] ?? '').trim() || null

    const { value: roomTypeValue, defaulted } = normalizeRoomType(row[ROOM_TYPE_KEY])
    let room_type = roomTypeValue
    if (roomTypeValue === null) {
      messages.push(`Unrecognized Room Type "${row[ROOM_TYPE_KEY]}" — use hotel, airbnb, or other_max_pax`)
      room_type = 'hotel'
      bump('error')
    } else if (defaulted) {
      messages.push('Room Type left blank — defaulted to "hotel"')
      bump('warning')
    }

    const platformIdRaw = String(row[PLATFORM_ID_KEY] ?? '').trim()
    let rowPlatform = platform
    let platform_id = platformIdRaw || null

    let max_capacity = null
    const maxCapRaw = String(row[MAX_CAPACITY_KEY] ?? '').trim()
    if (maxCapRaw !== '') {
      const n = Number(maxCapRaw)
      if (!Number.isFinite(n) || n <= 0) {
        messages.push(`Invalid Max Capacity "${row[MAX_CAPACITY_KEY]}"`)
        bump('error')
      } else {
        max_capacity = Math.round(n)
      }
    }

    if (room_type === 'other_max_pax') {
      rowPlatform = 'other'
      if (platformIdRaw) messages.push('Platform ID is ignored for "Other (Max Pax)" rooms')
      platform_id = null
      if (maxCapRaw === '') {
        messages.push('Max Capacity is required for "Other (Max Pax)" rooms')
        bump('error')
      }
    } else if (platform_id && rowPlatform !== 'other') {
      const dupe = existingRooms.find(r => (r.platform_id || '').toLowerCase() === platform_id.toLowerCase())
      if (dupe) {
        messages.push(`Platform ID already used by existing room "${dupe.name}"`)
        bump('warning')
      }
    } else if (!platform_id && rowPlatform !== 'other') {
      messages.push('No Platform ID — this room won\'t sync automatically and can\'t be mapped by Platform ID in GonnaOrder')
      bump('warning')
    }

    return {
      index: i,
      name,
      secondary_name,
      room_type,
      platform_id,
      platform: rowPlatform,
      max_capacity,
      store_id: storeId || null,
      status,
      messages,
    }
  })

  // Second pass: flag Platform IDs duplicated within this same file.
  const seenAt = new Map()
  for (const r of results) {
    if (!r.platform_id) continue
    const key = r.platform_id.toLowerCase()
    if (seenAt.has(key)) {
      const first = results[seenAt.get(key)]
      r.messages.push(`Duplicate Platform ID also used in row ${first.index + 2} of this file`)
      if (r.status === 'ready') r.status = 'warning'
      if (first.status === 'ready') first.status = 'warning'
    } else {
      seenAt.set(key, r.index)
    }
  }

  return results
}

export { downloadXlsxBuffer, safeFilenameSegment } from './gonnaorderExport'
