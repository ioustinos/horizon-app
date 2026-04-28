// gonnaorderExport.js
// Build a GonnaOrder Table_Import.xlsx file from a list of Horizon rooms.
//
// The xlsx layout MUST match GonnaOrder's "Locations import" template:
// 17 columns, a single "Table_Import" sheet, one row per location.
//
// The critical column for us is "External Id" — we set it to the Horizon
// rooms.id (UUID) so that GonnaOrder's webhook payload reaches us with
// `location.externalId === <horizon-room-uuid>`, which validate-breakfast
// then matches against rooms.id directly.
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

// Build one row from a Horizon room.
function rowForRoom(room) {
  // A short comment that helps the operator identify which platform listing
  // this room came from, when reviewing the import in GonnaOrder.
  const comment = room.platform_id
    ? `Horizon ${room.platform || 'room'} · platform_id: ${room.platform_id}`
    : 'Horizon room'

  return {
    'Table Name or Number *':         room.name || '',
    'Description':                    room.secondary_name || '',
    'Comment':                        comment,
    'Location Types *':               'LOCATION',
    'Reservation maximum capacity':   room.max_capacity ?? '',
    'Reservation minimum capacity':   '',
    'Reservation priority':           '',
    'Allow customers reservations':   'No',
    'External Id':                    room.id, // ← Horizon UUID, the magic field
    'Address Line 1':                 '',
    'Address Line 2':                 '',
    'Post Code':                      '',
    'Region':                         '',
    'City':                           '',
    'GPS coordinates':                '',
    'Email':                          '',
    'Phone Number':                   '',
  }
}

// Build an xlsx ArrayBuffer for the supplied rooms.
export function buildGonnaOrderXlsxBuffer(rooms) {
  const rows = rooms.map(rowForRoom)
  const ws = XLSX.utils.json_to_sheet(rows, { header: GO_HEADERS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Table_Import')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// Trigger a browser download of the generated file.
export function downloadGonnaOrderXlsx(rooms, fileName) {
  const buf = buildGonnaOrderXlsxBuffer(rooms)
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
  // Defer revoke to give the browser time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Sanitize a store name for use as part of a filename.
export function safeFilenameSegment(s) {
  return (s || 'store')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'store'
}
