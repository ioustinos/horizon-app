import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const EMPTY_OFFER = {
  offerId: 0,
  categoryId: 0,
  parentId: 0,
  name: '',
  shortDescription: '',
  longDescription: '',
  price: 0,
  discount: 0,
  discountType: '',
  isSellable: true,
  isOrderable: true,
  hierarchyLevel: 'TOP',
  stockLevel: 0,
  isStockCheckEnabled: true,
  inStock: true,
  isDirectlyOrderable: true,
  vatPercentage: 0,
  externalProductId: '',
  isActive: true,
}

const EMPTY_ORDER_ITEM = {
  uuid: crypto.randomUUID(),
  offerId: 0,
  categoryId: 0,
  quantity: 1,
  totalQuantity: 1,
  categoryName: '',
  itemName: '',
  offerPrice: 0,
  discountedOfferPrice: 0,
  totalNonDiscountedPrice: 0,
  totalDiscountedPrice: 0,
  hierarchyLevel: 'TOP',
  externalProductId: '',
  offer: { ...EMPTY_OFFER },
}

function newOrderItem() {
  return {
    ...EMPTY_ORDER_ITEM,
    uuid: crypto.randomUUID(),
    offer: { ...EMPTY_OFFER },
  }
}

function newBreakfastItem() {
  return {
    ...EMPTY_ORDER_ITEM,
    uuid: crypto.randomUUID(),
    itemName: 'Breakfast',
    categoryName: 'Breakfast',
    offerPrice: 0,
    offer: {
      ...EMPTY_OFFER,
      name: 'Breakfast',
      stockLevel: 0,
      isStockCheckEnabled: true,
    },
  }
}

export default function TestWebhook() {
  const [stores, setStores] = useState([])
  const [rooms, setRooms] = useState([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState(null)
  const [responseStatus, setResponseStatus] = useState(null)

  // Order fields
  const [order, setOrder] = useState({
    orderId: 1,
    storeId: '',
    uuid: crypto.randomUUID(),
    orderToken: 'test-token',
    status: 'SUBMITTED',
    location: '',
    locationDescription: '',
    locationExternalId: '',
    createdAt: new Date().toISOString(),
    wishTime: new Date().toISOString(),
    customerName: 'Test Guest',
    customerEmail: 'test@example.com',
    customerPhoneNumber: '+30 000 000 0000',
    deliveryMethod: 'IN_STORE',
    paymentStatus: 'NOT_PAID',
    paymentMethod: 'UNDEFINED',
    totalDiscountedPrice: 0,
    totalNonDiscountedPrice: 0,
    currency: 'EUR',
    currencyIsoCode: 'EUR',
    validated: false,
    comment: '',
  })

  const [orderItems, setOrderItems] = useState([newBreakfastItem()])

  // Load stores
  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, gonnaorder_store_id')
      .order('name')
      .then(({ data }) => setStores(data || []))
  }, [])

  // Load rooms when store changes
  useEffect(() => {
    if (!selectedStoreId) {
      setRooms([])
      return
    }
    supabase
      .from('rooms')
      .select('id, name')
      .eq('store_id', selectedStoreId)
      .order('name')
      .then(({ data }) => setRooms(data || []))
  }, [selectedStoreId])

  // When store selection changes, update order fields
  function handleStoreSelect(storeDbId) {
    setSelectedStoreId(storeDbId)
    setSelectedRoomId('')
    const store = stores.find(s => s.id === storeDbId)
    if (store) {
      setOrder(prev => ({
        ...prev,
        storeId: store.gonnaorder_store_id,
      }))
    }
  }

  // When room selection changes, update locationExternalId with the room's internal ID
  function handleRoomSelect(roomDbId) {
    setSelectedRoomId(roomDbId)
    const room = rooms.find(f => f.id === roomDbId)
    if (room) {
      setOrder(prev => ({
        ...prev,
        locationExternalId: room.id,
        locationDescription: room.name,
      }))
    }
  }

  function updateOrder(field, value) {
    setOrder(prev => ({ ...prev, [field]: value }))
  }

  function updateOrderItem(index, field, value) {
    setOrderItems(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  function updateOffer(index, field, value) {
    setOrderItems(prev => {
      const copy = [...prev]
      copy[index] = {
        ...copy[index],
        offer: { ...copy[index].offer, [field]: value },
      }
      return copy
    })
  }

  function addItem() {
    setOrderItems(prev => [...prev, newOrderItem()])
  }

  function addBreakfastItem() {
    setOrderItems(prev => [...prev, newBreakfastItem()])
  }

  function removeItem(index) {
    setOrderItems(prev => prev.filter((_, i) => i !== index))
  }

  async function sendRequest() {
    setSending(true)
    setResponse(null)
    setResponseStatus(null)

    // Generate a fresh UUID for each send to avoid upsert collisions
    const freshUuid = crypto.randomUUID()

    const payload = {
      ...order,
      uuid: freshUuid,
      orderItems: orderItems.map(item => ({
        ...item,
        totalNonDiscountedPrice: item.offerPrice * item.quantity,
        totalDiscountedPrice: (item.discountedOfferPrice || item.offerPrice) * item.quantity,
      })),
    }

    // Update the displayed UUID
    setOrder(prev => ({ ...prev, uuid: freshUuid }))

    try {
      const res = await fetch('/api/validate-breakfast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      setResponse(data)
      setResponseStatus(res.status)
    } catch (err) {
      setResponse({ error: err.message })
      setResponseStatus(0)
    } finally {
      setSending(false)
    }
  }

  const isBreakfastItem = (item) =>
    item.offer?.stockLevel === 0 && item.offer?.isStockCheckEnabled === true

  return (
    <div className="page">
      <div className="page-header">
        <h1>Test Webhook</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Send test requests to the breakfast validation endpoint
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* ── LEFT COLUMN: Form ─────────────────────────────── */}
        <div>
          {/* Quick Select */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Quick Select
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label className="field">
                <span className="field-label">Store</span>
                <select value={selectedStoreId} onChange={e => handleStoreSelect(e.target.value)}>
                  <option value="">— Select store —</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.gonnaorder_store_id})</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Room</span>
                <select value={selectedRoomId} onChange={e => handleRoomSelect(e.target.value)} disabled={!selectedStoreId}>
                  <option value="">— Select room —</option>
                  {rooms.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Order Fields */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Order Fields
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label className="field">
                <span className="field-label">storeId</span>
                <input value={order.storeId} onChange={e => updateOrder('storeId', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">locationExternalId</span>
                <input value={order.locationExternalId} onChange={e => updateOrder('locationExternalId', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">uuid</span>
                <input value={order.uuid} onChange={e => updateOrder('uuid', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">status</span>
                <select value={order.status} onChange={e => updateOrder('status', e.target.value)}>
                  <option>SUBMITTED</option>
                  <option>RECEIVED</option>
                  <option>IN_PREPARATION</option>
                  <option>READY</option>
                  <option>COMPLETED</option>
                  <option>CANCELLED</option>
                </select>
              </label>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span className="field-label">wishTime</span>
                <input type="datetime-local" value={order.wishTime.slice(0, 16)} onChange={e => updateOrder('wishTime', e.target.value + ':00.000Z')} />
              </label>
              <label className="field">
                <span className="field-label">customerName</span>
                <input value={order.customerName} onChange={e => updateOrder('customerName', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">customerEmail</span>
                <input value={order.customerEmail} onChange={e => updateOrder('customerEmail', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">deliveryMethod</span>
                <select value={order.deliveryMethod} onChange={e => updateOrder('deliveryMethod', e.target.value)}>
                  <option>IN_STORE</option>
                  <option>DELIVERY</option>
                  <option>PICKUP</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">paymentStatus</span>
                <select value={order.paymentStatus} onChange={e => updateOrder('paymentStatus', e.target.value)}>
                  <option>NOT_PAID</option>
                  <option>PAID</option>
                  <option>PARTIALLY_PAID</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">currency</span>
                <input value={order.currency} onChange={e => updateOrder('currency', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">comment</span>
                <input value={order.comment} onChange={e => updateOrder('comment', e.target.value)} />
              </label>
            </div>
          </div>

          {/* Order Items */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Order Items ({orderItems.length})
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-sm btn-primary" onClick={addBreakfastItem}>
                  + Breakfast Item
                </button>
                <button className="btn btn-sm btn-ghost" onClick={addItem}>
                  + Generic Item
                </button>
              </div>
            </div>

            {orderItems.map((item, idx) => (
              <div
                key={item.uuid}
                style={{
                  border: `2px solid ${isBreakfastItem(item) ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  padding: '0.75rem',
                  marginBottom: '0.75rem',
                  background: isBreakfastItem(item) ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    Item #{idx + 1}
                    {isBreakfastItem(item) && (
                      <span style={{
                        marginLeft: '0.5rem',
                        background: 'var(--accent)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}>
                        Breakfast
                      </span>
                    )}
                  </span>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => removeItem(idx)}
                  >
                    Remove
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                  <label className="field">
                    <span className="field-label">itemName</span>
                    <input value={item.itemName} onChange={e => updateOrderItem(idx, 'itemName', e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field-label">quantity</span>
                    <input type="number" min="1" value={item.quantity} onChange={e => updateOrderItem(idx, 'quantity', parseInt(e.target.value) || 1)} />
                  </label>
                  <label className="field">
                    <span className="field-label">offerPrice</span>
                    <input type="number" step="0.01" value={item.offerPrice} onChange={e => updateOrderItem(idx, 'offerPrice', parseFloat(e.target.value) || 0)} />
                  </label>
                  <label className="field">
                    <span className="field-label">categoryName</span>
                    <input value={item.categoryName} onChange={e => updateOrderItem(idx, 'categoryName', e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field-label">hierarchyLevel</span>
                    <select value={item.hierarchyLevel} onChange={e => updateOrderItem(idx, 'hierarchyLevel', e.target.value)}>
                      <option>TOP</option>
                      <option>PARENT</option>
                      <option>CHILD</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">offerId</span>
                    <input type="number" value={item.offerId} onChange={e => updateOrderItem(idx, 'offerId', parseInt(e.target.value) || 0)} />
                  </label>
                </div>

                {/* Offer sub-fields */}
                <details style={{ marginTop: '0.5rem' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Offer details (stockLevel, isStockCheckEnabled, ...)
                  </summary>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <label className="field">
                      <span className="field-label">offer.name</span>
                      <input value={item.offer.name} onChange={e => updateOffer(idx, 'name', e.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field-label">offer.stockLevel</span>
                      <input type="number" value={item.offer.stockLevel} onChange={e => updateOffer(idx, 'stockLevel', parseInt(e.target.value))} />
                    </label>
                    <label className="field">
                      <span className="field-label">offer.isStockCheckEnabled</span>
                      <select
                        value={item.offer.isStockCheckEnabled ? 'true' : 'false'}
                        onChange={e => updateOffer(idx, 'isStockCheckEnabled', e.target.value === 'true')}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">offer.price</span>
                      <input type="number" step="0.01" value={item.offer.price} onChange={e => updateOffer(idx, 'price', parseFloat(e.target.value) || 0)} />
                    </label>
                    <label className="field">
                      <span className="field-label">offer.isSellable</span>
                      <select
                        value={item.offer.isSellable ? 'true' : 'false'}
                        onChange={e => updateOffer(idx, 'isSellable', e.target.value === 'true')}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">offer.externalProductId</span>
                      <input value={item.offer.externalProductId} onChange={e => updateOffer(idx, 'externalProductId', e.target.value)} />
                    </label>
                  </div>
                </details>
              </div>
            ))}
          </div>

          {/* Send Button */}
          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
            onClick={sendRequest}
            disabled={sending}
          >
            {sending ? 'Sending...' : 'Send Validation Request'}
          </button>
        </div>

        {/* ── RIGHT COLUMN: Response ───────────────────────── */}
        <div>
          {/* Request Preview */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Request Preview
            </h3>
            <pre style={{
              background: 'var(--bg-secondary)',
              padding: '0.75rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              maxHeight: '300px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {JSON.stringify({ ...order, orderItems }, null, 2)}
            </pre>
          </div>

          {/* Response */}
          <div className="card" style={{ padding: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Response
              {responseStatus !== null && (
                <span style={{
                  marginLeft: '0.5rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  background: responseStatus === 200 ? 'var(--success-bg, #dcfce7)' : 'var(--danger-bg, #fde8e8)',
                  color: responseStatus === 200 ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)',
                }}>
                  {responseStatus}
                </span>
              )}
            </h3>

            {response ? (
              <>
                {response.valid !== undefined && (
                  <div style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    marginBottom: '0.75rem',
                    background: response.valid ? '#dcfce7' : '#fde8e8',
                    border: `1px solid ${response.valid ? '#86efac' : '#fca5a5'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}>
                    <span style={{ fontSize: '1.5rem' }}>{response.valid ? '\u2705' : '\u274C'}</span>
                    <div>
                      <div style={{ fontWeight: 700, color: response.valid ? '#166534' : '#991b1b' }}>
                        {response.valid ? 'VALID — Breakfast Approved' : 'INVALID — Breakfast Denied'}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: response.valid ? '#166534' : '#991b1b', opacity: 0.8 }}>
                        {response.message || response.reason}
                      </div>
                    </div>
                  </div>
                )}

                {response.entitled !== undefined && response.entitled !== null && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{response.requested}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Requested</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{response.entitled}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Entitled</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{response.remaining ?? '—'}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Remaining</div>
                    </div>
                  </div>
                )}

                <pre style={{
                  background: 'var(--bg-secondary)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  maxHeight: '400px',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(response, null, 2)}
                </pre>
              </>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Send a request to see the validation response here.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
