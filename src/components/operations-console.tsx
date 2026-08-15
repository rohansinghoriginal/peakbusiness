'use client'

import { Show, SignInButton, SignUpButton, UserButton, useUser } from '@clerk/nextjs'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { appConfig } from '@/lib/app-config'
import { asNumber, formatCurrency, formatNumber, toDateInput } from '@/lib/business'
import { useTheme } from '@/lib/theme-context'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ProductTour, replayTour } from '@/components/product-tour'
import {
  fieldAliases,
  type DocumentAnalysis,
  type ImportMapping,
  type RawRow,
  type PlatformType,
  type DocumentType,
} from '@/lib/import-mapping'

const importFields = [
  { id: 'orderId', label: 'Order ID', required: true },
  { id: 'skuCode', label: 'SKU code', required: true },
  { id: 'productName', label: 'Product name', required: false },
  { id: 'lineKey', label: 'Line item key', required: false },
  { id: 'orderDate', label: 'Order date', required: false },
  { id: 'qtyOrdered', label: 'Qty ordered', required: false },
  { id: 'qtyDelivered', label: 'Qty delivered', required: false },
  { id: 'qtyReturned', label: 'Qty returned', required: false },
  { id: 'salePrice', label: 'Sale price', required: false },
  { id: 'status', label: 'Status', required: false },
  { id: 'deliveryDate', label: 'Delivery date', required: false },
  { id: 'returnDate', label: 'Return date', required: false },
  { id: 'refundAmount', label: 'Refund amount', required: false },
  { id: 'customerLocation', label: 'Customer location', required: false },
] as const

type Row = Record<string, any>
type View = 'overview' | 'orders' | 'analytics' | 'catalog' | 'materials' | 'purchasing' | 'finance' | 'imports' | 'settings'

const initialDashboard = { metrics: {}, orders: [], skus: [], materials: [], lowStock: [], expenses: [], borrowings: [], purchases: [] } as Row

const navItems: Array<{ id: View; label: string; eyebrow: string }> = [
  { id: 'overview', label: 'Overview', eyebrow: 'Live pulse' },
  { id: 'orders', label: 'Orders', eyebrow: 'Sales activity' },
  { id: 'analytics', label: 'Analytics', eyebrow: 'Profit & margins' },
  { id: 'catalog', label: 'Products', eyebrow: 'SKU master' },
  { id: 'materials', label: 'Materials', eyebrow: 'Stock & BOM' },
  { id: 'purchasing', label: 'Purchasing', eyebrow: 'Suppliers & costs' },
  { id: 'finance', label: 'Finance', eyebrow: 'Expenses & lending' },
  { id: 'imports', label: 'Imports', eyebrow: 'Marketplace reports' },
  { id: 'settings', label: 'Workspace', eyebrow: 'Controls & export' },
]

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Request failed.')
  return payload as T
}

function Button({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><p>{detail}</p>{action}</div>
}

function DataTable({ columns, rows, empty = 'Nothing here yet.' }: { columns: Array<{ label: string; value: (row: Row) => React.ReactNode }>; rows: Row[]; empty?: string }) {
  if (!rows.length) return <EmptyState title={empty} detail="Add your first record to start seeing operational insight." />
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}</tr>)}</tbody></table></div>
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{detail}</p></div>{action}</div>
}

function MetricCard({ label, value, tone = 'default', note }: { label: string; value: string; tone?: 'default' | 'positive' | 'warm' | 'alert'; note?: string }) {
  return <article className={`metric-card ${tone}`}><p>{label}</p><strong>{value}</strong>{note ? <small>{note}</small> : <span className="metric-orb" />}</article>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>{children}</section></div>
}

export function OperationsConsole() {
  const { user, isLoaded } = useUser()
  const { theme, toggleTheme } = useTheme()
  const [view, setView] = useState<View>('overview')
  const [dashboard, setDashboard] = useState<Row>(initialDashboard)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [composer, setComposer] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<Row>('/api/dashboard')
      setDashboard(data)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the workspace.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const completed = async (message: string) => {
    setComposer(null)
    setNotice(message)
    await refresh()
    window.setTimeout(() => setNotice(''), 3400)
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">PB</span><span><b>Peak</b> Business</span></div>
        <div className="workspace-chip"><span className="status-dot" />Operations workspace</div>
        <nav aria-label="Primary navigation">{navItems.map((item) => <button key={item.id} data-tour={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><span className="nav-glyph">{item.label.slice(0, 1)}</span><span><b>{item.label}</b><small>{item.eyebrow}</small></span></button>)}</nav>
        <div className="sidebar-foot"><p>Data is protected by Clerk + Supabase.</p><ThemeToggle showLabel /></div>
      </aside>
      <section className="main-stage">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">PB</span>Peak Business</div><div className="topbar-right"><button className="refresh" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button><Show when="signed-in"><UserButton appearance={{ elements: { avatarBox: 'avatar-box' } }} /></Show><Show when="signed-out"><SignInButton><Button>Sign in</Button></SignInButton><SignUpButton><Button className="primary">Create account</Button></SignUpButton></Show></div></header>
        <div className="content-stage">
          {notice ? <div className="toast success">✓ {notice}</div> : null}
          {error ? <div className="toast error"><strong>Setup attention needed.</strong> {error}<button onClick={() => void refresh()}>Retry</button></div> : null}
          {!isLoaded ? <div className="page-loader">Loading your workspace…</div> : null}
          {view === 'overview' ? <Overview dashboard={dashboard} loading={loading} onQuickAdd={setComposer} onNavigate={setView} /> : null}
          {view === 'orders' ? <OrdersView dashboard={dashboard} onAdd={() => setComposer('order')} /> : null}
          {view === 'analytics' ? <AnalyticsView /> : null}
          {view === 'catalog' ? <CatalogView dashboard={dashboard} onAdd={() => setComposer('sku')} /> : null}
          {view === 'materials' ? <MaterialsView dashboard={dashboard} onAdd={() => setComposer('material')} onAdjust={() => setComposer('adjustment')} /> : null}
          {view === 'purchasing' ? <PurchasingView dashboard={dashboard} onPurchase={() => setComposer('purchase')} onSupplier={() => setComposer('supplier')} /> : null}
          {view === 'finance' ? <FinanceView dashboard={dashboard} onExpense={() => setComposer('expense')} onBorrow={() => setComposer('borrowing')} /> : null}
          {view === 'imports' ? <ImportsView onComplete={completed} /> : null}
          {view === 'settings' ? <SettingsView onComplete={completed} /> : null}
        </div>
      </section>
      {composer === 'sku' ? <SkuForm onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'material' ? <MaterialForm onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'order' ? <OrderForm skus={dashboard.skus || []} onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'adjustment' ? <AdjustmentForm materials={dashboard.materials || []} onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'supplier' ? <SupplierForm onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'purchase' ? <PurchaseForm materials={dashboard.materials || []} onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'expense' ? <ExpenseForm onClose={() => setComposer(null)} onComplete={completed} /> : null}
      {composer === 'borrowing' ? <BorrowingForm onClose={() => setComposer(null)} onComplete={completed} /> : null}
      <ProductTour onNavigate={(value) => setView(value as View)} enabled={isLoaded} />
    </main>
  )
}

function Overview({ dashboard, loading, onQuickAdd, onNavigate }: { dashboard: Row; loading: boolean; onQuickAdd: (value: string) => void; onNavigate: (value: View) => void }) {
  const metrics = dashboard.metrics || {}
  const orders = (dashboard.orders || []) as Row[]
  const chart = useMemo(() => orders.slice(0, 7).reverse().map((order: Row) => ({ label: toDateInput(order.order_date).slice(5), value: asNumber(order.revenue) })), [orders])
  const maxValue = Math.max(...chart.map((item) => item.value), 1)
  return <>
    <SectionHeading eyebrow="Command center" title="Keep the business moving." detail="A calm, live read of sales, stock and cash pressure." action={<div className="heading-actions"><Button onClick={() => onQuickAdd('order')} className="primary">+ Record order</Button><Button onClick={() => onNavigate('imports')}>Import sales</Button></div>} />
    <section className="metrics-grid">
      <MetricCard label="Net profit" value={formatCurrency(metrics.netProfit)} tone={asNumber(metrics.netProfit) >= 0 ? 'positive' : 'alert'} note="Revenue less COGS & expenses" />
      <MetricCard label="Revenue" value={formatCurrency(metrics.revenue)} tone="default" note={`${formatNumber(metrics.unitsDelivered)} units delivered`} />
      <MetricCard label="Material value" value={formatCurrency(metrics.materialInventoryValue)} tone="warm" note="Current stock valuation" />
      <MetricCard label="Restock watch" value={formatNumber(metrics.lowStockCount)} tone={asNumber(metrics.lowStockCount) ? 'alert' : 'positive'} note="SKUs and materials at threshold" />
    </section>
    <section className="dashboard-grid">
      <article className="panel revenue-panel"><div className="panel-title"><div><p className="eyebrow">Momentum</p><h2>Recent sales</h2></div><span>{loading ? 'Updating' : 'Last activity'}</span></div>{chart.length ? <div className="bar-chart">{chart.map((item) => <div className="bar-item" key={item.label}><div className="bar-value" style={{ height: `${Math.max((item.value / maxValue) * 100, 5)}%` }} title={formatCurrency(item.value)} /><small>{item.label}</small></div>)}</div> : <EmptyState title="Your revenue chart starts here" detail="Record an order or import a marketplace report to reveal the trend." action={<Button className="primary" onClick={() => onQuickAdd('order')}>Record an order</Button>} />}</article>
      <article className="panel quick-panel"><div className="panel-title"><div><p className="eyebrow">Fast lane</p><h2>Common actions</h2></div></div><div className="quick-actions"><button onClick={() => onQuickAdd('order')}><span>01</span>Record an order</button><button onClick={() => onQuickAdd('purchase')}><span>02</span>Log a purchase</button><button onClick={() => onQuickAdd('expense')}><span>03</span>Add an expense</button><button onClick={() => onNavigate('imports')}><span>04</span>Import marketplace file</button></div></article>
    </section>
    <section className="dashboard-grid lower"><article className="panel"><div className="panel-title"><div><p className="eyebrow">Attention queue</p><h2>Restock signals</h2></div><button className="text-button" onClick={() => onNavigate('materials')}>Open materials →</button></div><DataTable rows={dashboard.lowStock || []} empty="No restock signals" columns={[{ label: 'Item', value: (row) => <><strong>{row.product_name || row.material_name}</strong><small>{row.item_type} · {row.sku_code || row.material_code}</small></> }, { label: 'On hand', value: (row) => formatNumber(row.current_stock) }, { label: 'Threshold', value: (row) => formatNumber(row.reorder_level) }]} /></article><article className="panel"><div className="panel-title"><div><p className="eyebrow">Freshest activity</p><h2>Latest orders</h2></div><button className="text-button" onClick={() => onNavigate('orders')}>View all →</button></div><DataTable rows={orders.slice(0, 5)} empty="No orders yet" columns={[{ label: 'Order', value: (row) => <><strong>{row.order_id}</strong><small>{row.platform}</small></> }, { label: 'Product', value: (row) => row.product_name }, { label: 'Value', value: (row) => formatCurrency(row.revenue) }]} /></article></section>
  </>
}

function OrdersView({ dashboard, onAdd }: { dashboard: Row; onAdd: () => void }) {
  const [orders, setOrders] = useState<Row[]>(dashboard.orders || [])
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({
    q: '',
    platform: '',
    status: '',
    entityType: '',
    skuCode: '',
    productName: '',
    orderId: '',
    customerLocation: '',
    dateFrom: '',
    dateTo: '',
    sortBy: 'order_date',
    sortOrder: 'desc'
  })
  const PAGE_SIZE = 50

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(page * PAGE_SIZE))
      
      const res = await api<{ data: Row[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }>(`/api/orders/search?${params.toString()}`)
      setOrders(res.data)
      setTotalCount(res.pagination.total)
    } catch (caught) {
      console.error('Failed to load orders:', caught)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(0) // Reset to first page when filters change
  }

  const clearFilters = () => {
    setFilters({
      q: '',
      platform: '',
      status: '',
      entityType: '',
      skuCode: '',
      productName: '',
      orderId: '',
      customerLocation: '',
      dateFrom: '',
      dateTo: '',
      sortBy: 'order_date',
      sortOrder: 'desc'
    })
    setPage(0)
  }

  const hasActiveFilters = Object.values(filters).some(v => v !== '' && v !== 'order_date' && v !== 'desc')

  return (
    <>
      <SectionHeading
        eyebrow="Sales ledger"
        title="Orders with context."
        detail="Delivery and returns automatically update product and material ledgers."
        action={
          <div className="heading-actions">
            <Button onClick={onAdd} className="primary">+ Record order</Button>
            {hasActiveFilters && <Button onClick={clearFilters} className="ghost">Clear filters</Button>}
          </div>
        }
      />
      
      {/* Search & Filter Bar */}
      <article className="panel filter-panel">
        <div className="filter-row">
          <div className="filter-group">
            <label>
              <span>Search</span>
              <input
                type="text"
                placeholder="Search orders, products, SKUs..."
                value={filters.q}
                onChange={(e) => handleFilterChange('q', e.target.value)}
                className="search-input"
              />
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Platform</span>
              <select value={filters.platform} onChange={(e) => handleFilterChange('platform', e.target.value)}>
                <option value="">All platforms</option>
                <option value="Amazon">Amazon</option>
                <option value="Meesho">Meesho</option>
                <option value="Flipkart">Flipkart</option>
                <option value="Shopify">Shopify</option>
                <option value="Offline">Offline</option>
              </select>
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Status</span>
              <select value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
                <option value="">All statuses</option>
                <option value="Delivered">Delivered</option>
                <option value="Pending">Pending</option>
                <option value="Shipped">Shipped</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Returned">Returned</option>
              </select>
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Entity Type</span>
              <select value={filters.entityType} onChange={(e) => handleFilterChange('entityType', e.target.value)}>
                <option value="">All types</option>
                <option value="order">Order</option>
                <option value="return">Return</option>
                <option value="settlement">Settlement</option>
              </select>
            </label>
          </div>
        </div>
        
        <div className="filter-row">
          <div className="filter-group">
            <label>
              <span>SKU Code</span>
              <input
                type="text"
                placeholder="Filter by SKU..."
                value={filters.skuCode}
                onChange={(e) => handleFilterChange('skuCode', e.target.value)}
              />
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Product Name</span>
              <input
                type="text"
                placeholder="Filter by product..."
                value={filters.productName}
                onChange={(e) => handleFilterChange('productName', e.target.value)}
              />
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Order ID</span>
              <input
                type="text"
                placeholder="Filter by Order ID..."
                value={filters.orderId}
                onChange={(e) => handleFilterChange('orderId', e.target.value)}
              />
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Customer Location</span>
              <input
                type="text"
                placeholder="Filter by location..."
                value={filters.customerLocation}
                onChange={(e) => handleFilterChange('customerLocation', e.target.value)}
              />
            </label>
          </div>
        </div>
        
        <div className="filter-row">
          <div className="filter-group">
            <label>
              <span>Date From</span>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              />
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Date To</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              />
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Sort By</span>
              <select value={filters.sortBy} onChange={(e) => handleFilterChange('sortBy', e.target.value)}>
                <option value="order_date">Order Date</option>
                <option value="created_at">Created At</option>
                <option value="sale_price">Sale Price</option>
                <option value="qty_delivered">Qty Delivered</option>
                <option value="qty_ordered">Qty Ordered</option>
                <option value="status">Status</option>
                <option value="platform">Platform</option>
              </select>
            </label>
          </div>
          
          <div className="filter-group">
            <label>
              <span>Order</span>
              <select value={filters.sortOrder} onChange={(e) => handleFilterChange('sortOrder', e.target.value)}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          </div>
        </div>
      </article>
      
      <article className="panel">
        {loading ? (
          <div className="loading-indicator">Loading orders...</div>
        ) : (
          <>
            <DataTable
              rows={orders}
              empty="No orders match your filters"
              columns={[
                { 
                  label: 'Order', 
                  value: (row) => (
                    <>
                      <strong>{row.order_id}</strong>
                      <small>{toDateInput(row.order_date)} · {row.platform}</small>
                    </>
                  ) 
                },
                { 
                  label: 'Product', 
                  value: (row) => (
                    <>
                      <strong>{row.product_name}</strong>
                      <small>{row.sku_code}</small>
                    </>
                  ) 
                },
                { label: 'Delivered', value: (row) => formatNumber(row.qty_delivered) },
                { label: 'Revenue', value: (row) => formatCurrency(row.revenue) },
                { label: 'Status', value: (row) => <span className="status-pill">{row.status}</span> },
                { label: 'Type', value: (row) => <span className="entity-badge">{row.entity_type || 'order'}</span> }
              ]}
            />
            
            {/* Pagination */}
            <div className="pagination">
              <span className="pagination-info">
                Showing {orders.length} of {totalCount} orders
              </span>
              <div className="pagination-controls">
                <Button 
                  onClick={() => setPage(p => Math.max(0, p - 1))} 
                  disabled={page === 0 || loading}
                >
                  ← Previous
                </Button>
                <span className="page-info">Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}</span>
                <Button 
                  onClick={() => setPage(p => p + 1)} 
                  disabled={loading || orders.length < PAGE_SIZE}
                >
                  Next →
                </Button>
              </div>
            </div>
</>
        )} 
      </article>
    </> 
  )} 
 
function AnalyticsView() {
  const [range, setRange] = useState<'all' | 'month' | '30d' | '7d'>('all')
  const [data, setData] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<Row>(`/api/analytics?range=${range}`)
      setData(res)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load analytics.')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load])

  const kpis = data?.kpis || {}
  const skuMargins = (data?.skuMargins || []) as Row[]
  const platforms = (data?.platforms || []) as Row[]
  const returnAnalytics = data?.returnAnalytics || {}

  return (
    <>
      <SectionHeading
        eyebrow="Profit intelligence"
        title="Analytics & Profitability."
        detail="SKU-level gross margins, multi-platform performance breakdowns, and return rate financial impacts."
        action={
          <div className="filter-bar">
            <button className={`filter-btn ${range === 'all' ? 'active' : ''}`} onClick={() => setRange('all')}>All time</button>
            <button className={`filter-btn ${range === 'month' ? 'active' : ''}`} onClick={() => setRange('month')}>This month</button>
            <button className={`filter-btn ${range === '30d' ? 'active' : ''}`} onClick={() => setRange('30d')}>Last 30 days</button>
            <button className={`filter-btn ${range === '7d' ? 'active' : ''}`} onClick={() => setRange('7d')}>Last 7 days</button>
          </div>
        }
      />

      {error ? <div className="toast error">{error}</div> : null}

      <section className="metrics-grid">
        <MetricCard
          label="Net margin"
          value={`${kpis.netProfitMarginPct ?? 0}%`}
          tone={asNumber(kpis.netProfit) >= 0 ? 'positive' : 'alert'}
          note={`${formatCurrency(kpis.netProfit)} net profit`}
        />
        <MetricCard
          label="Gross profit"
          value={formatCurrency(kpis.grossProfit)}
          tone="default"
          note={`${kpis.grossMarginPct ?? 0}% gross margin on sales`}
        />
        <MetricCard
          label="Return rate"
          value={`${kpis.overallReturnRatePct ?? 0}%`}
          tone={asNumber(kpis.overallReturnRatePct) > 15 ? 'alert' : 'positive'}
          note={`${formatNumber(kpis.totalReturnedUnits)} units returned`}
        />
        <MetricCard
          label="Refund loss"
          value={formatCurrency(kpis.totalRefundLoss)}
          tone="warm"
          note="Direct returns financial impact"
        />
      </section>

      <section className="panel" style={{ marginTop: '16px' }}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Product economics</p>
            <h2>SKU Margin & Profitability Matrix</h2>
          </div>
          <span>{skuMargins.length} active SKUs</span>
        </div>
        <DataTable
          rows={skuMargins}
          empty="No SKU performance data recorded for this timeframe"
          columns={[
            {
              label: 'Product / SKU',
              value: (row) => (
                <>
                  <strong>{row.productName}</strong>
                  <small>{row.skuCode} · {row.platform}</small>
                </>
              ),
            },
            { label: 'Selling price', value: (row) => formatCurrency(row.sellingPrice) },
            { label: 'Unit / BOM cost', value: (row) => formatCurrency(row.unitCost) },
            { label: 'Sold', value: (row) => formatNumber(row.unitsDelivered) },
            { label: 'Net revenue', value: (row) => formatCurrency(row.netRevenue) },
            { label: 'Gross profit', value: (row) => formatCurrency(row.grossProfit) },
            {
              label: 'Margin %',
              value: (row) => <strong>{row.grossMarginPct}%</strong>,
            },
            {
              label: 'Health',
              value: (row) => <span className={`tier-badge ${row.tier}`}>{row.tier}</span>,
            },
          ]}
        />
      </section>

      <section className="dashboard-grid lower" style={{ marginTop: '16px' }}>
        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Channel breakdown</p>
              <h2>Platform Performance</h2>
            </div>
            <span>{platforms.length} platforms</span>
          </div>
          {platforms.length ? (
            <div className="platform-cards-grid">
              {platforms.map((p) => (
                <div key={p.platform} className="platform-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3>{p.platform}</h3>
                    <span className="status-pill">{p.revenueSharePct}% share</span>
                  </div>
                  <div className="stat-row"><span>Orders:</span> <b>{formatNumber(p.orderCount)}</b></div>
                  <div className="stat-row"><span>Net revenue:</span> <b>{formatCurrency(p.netRevenue)}</b></div>
                  <div className="stat-row"><span>Gross profit:</span> <b>{formatCurrency(p.grossProfit)} ({p.grossMarginPct}%)</b></div>
                  <div className="stat-row"><span>Return rate:</span> <b style={{ color: p.returnRatePct > 15 ? 'var(--danger)' : 'inherit' }}>{p.returnRatePct}%</b></div>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar" style={{ width: `${Math.max(p.revenueSharePct, 4)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No platform sales yet" detail="Record sales or import marketplace data to view platform shares." />
          )}
        </article>

        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Return watch</p>
              <h2>Highest Return SKUs</h2>
            </div>
            <span>Impact: {formatCurrency(returnAnalytics.totalRefundLoss || 0)}</span>
          </div>
          <DataTable
            rows={returnAnalytics.topReturnedSkus || []}
            empty="No returns recorded in this timeframe. Excellent!"
            columns={[
              {
                label: 'Product',
                value: (row) => (
                  <>
                    <strong>{row.productName}</strong>
                    <small>{row.skuCode} · {row.platform}</small>
                  </>
                ),
              },
              { label: 'Units returned', value: (row) => <b style={{ color: 'var(--danger)' }}>{formatNumber(row.unitsReturned)}</b> },
              { label: 'Return rate', value: (row) => <strong>{row.returnRatePct}%</strong> },
              { label: 'Refund loss', value: (row) => formatCurrency(row.refundAmount) },
            ]}
          />
        </article>
      </section>
    </>
  )
}

function CatalogView({ dashboard, onAdd }: { dashboard: Row; onAdd: () => void }) {
  return <><SectionHeading eyebrow="Product master" title="Products that know their numbers." detail="Maintain price, cost, opening stock and platform-specific SKU mapping." action={<Button className="primary" onClick={onAdd}>+ Add SKU</Button>} /><article className="panel"><DataTable rows={dashboard.skus || []} empty="No SKUs yet" columns={[{ label: 'Product', value: (row) => <><strong>{row.product_name}</strong><small>{row.sku_code} · {row.platform}</small></> }, { label: 'On hand', value: (row) => formatNumber(row.current_stock) }, { label: 'Selling', value: (row) => formatCurrency(row.selling_price) }, { label: 'Unit cost', value: (row) => formatCurrency(row.cost_per_unit) }, { label: 'Stock value', value: (row) => formatCurrency(row.stock_value) }]} /></article></>
}

function MaterialsView({ dashboard, onAdd, onAdjust }: { dashboard: Row; onAdd: () => void; onAdjust: () => void }) {
  return <><SectionHeading eyebrow="Material control" title="Know what is on the shelf." detail="Material purchases, manual adjustments, and sales consumption form a clear stock ledger." action={<div className="heading-actions"><Button onClick={onAdjust}>Adjust stock</Button><Button className="primary" onClick={onAdd}>+ Add material</Button></div>} /><article className="panel"><DataTable rows={dashboard.materials || []} empty="No materials yet" columns={[{ label: 'Material', value: (row) => <><strong>{row.material_name}</strong><small>{row.material_code} · {row.unit}</small></> }, { label: 'On hand', value: (row) => formatNumber(row.current_stock) }, { label: 'Reorder at', value: (row) => formatNumber(row.reorder_level) }, { label: 'Average cost', value: (row) => formatCurrency(row.avg_unit_cost) }, { label: 'Value', value: (row) => formatCurrency(row.stock_value) }]} /></article></>
}

function PurchasingView({ dashboard, onPurchase, onSupplier }: { dashboard: Row; onPurchase: () => void; onSupplier: () => void }) {
  return <><SectionHeading eyebrow="Procurement" title="Buy with a complete paper trail." detail="Supplier templates keep GST, transport and purchase costs repeatable." action={<div className="heading-actions"><Button onClick={onSupplier}>+ Supplier</Button><Button className="primary" onClick={onPurchase}>+ Purchase</Button></div>} /><article className="panel"><DataTable rows={dashboard.purchases || []} empty="No purchases yet" columns={[{ label: 'Purchase', value: (row) => <><strong>{toDateInput(row.purchase_date)}</strong><small>{row.invoice_no || 'No invoice number'}</small></> }, { label: 'Quantity', value: (row) => `${formatNumber(row.quantity)} ${row.unit}` }, { label: 'Total', value: (row) => formatCurrency(row.total_amount) }, { label: 'GST', value: (row) => `${formatNumber(row.gst_rate)}%` }]} /></article></>
}

function FinanceView({ dashboard, onExpense, onBorrow }: { dashboard: Row; onExpense: () => void; onBorrow: () => void }) {
  const borrowings = dashboard.borrowings || []
  return <><SectionHeading eyebrow="Finance desk" title="Costs and commitments, visible." detail="Keep operating expenses distinct from borrowed and lent material positions." action={<div className="heading-actions"><Button onClick={onBorrow}>+ Borrow / lend</Button><Button className="primary" onClick={onExpense}>+ Expense</Button></div>} /><section className="dashboard-grid lower"><article className="panel"><div className="panel-title"><div><p className="eyebrow">Operating costs</p><h2>Latest expenses</h2></div></div><DataTable rows={dashboard.expenses || []} empty="No expenses yet" columns={[{ label: 'Date', value: (row) => toDateInput(row.expense_date) }, { label: 'Category', value: (row) => <><strong>{row.category}</strong><small>{row.description}</small></> }, { label: 'Amount', value: (row) => formatCurrency(row.amount) }]} /></article><article className="panel"><div className="panel-title"><div><p className="eyebrow">Open positions</p><h2>Borrow / lend</h2></div></div><DataTable rows={borrowings} empty="No borrow/lend records" columns={[{ label: 'Counterparty', value: (row) => <><strong>{row.counterparty}</strong><small>{row.direction}</small></> }, { label: 'Item', value: (row) => row.item_name }, { label: 'Open quantity', value: (row) => formatNumber(row.outstanding_qty) }, { label: 'Value', value: (row) => formatCurrency(row.outstanding_value) }]} /></article></section></>
}

function FormMessage({ error }: { error: string }) {
  return error ? <p className="form-error">{error}</p> : null
}

function SkuForm({ onClose, onComplete }: { onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError('')
    try { const form = new FormData(event.currentTarget); await api('/api/catalog/skus', { method: 'POST', body: JSON.stringify({ skuCode: form.get('skuCode'), productName: form.get('productName'), category: form.get('category'), platform: form.get('platform'), sellingPrice: form.get('sellingPrice'), costPerUnit: form.get('costPerUnit'), openingStock: form.get('openingStock'), reorderLevel: form.get('reorderLevel'), notes: form.get('notes') }) }); await onComplete('SKU saved.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save SKU.') } finally { setSaving(false) }
  }
  return <Modal title="Add product SKU" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="SKU code"><input name="skuCode" required placeholder="CAM-100-AZ" /></Field><Field label="Product name"><input name="productName" required placeholder="100g Camphor" /></Field><Field label="Platform"><select name="platform">{appConfig.supportedPlatforms.map((platform) => <option key={platform}>{platform}</option>)}</select></Field><Field label="Category"><input name="category" placeholder="Camphor" /></Field><Field label="Selling price"><input name="sellingPrice" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Unit cost"><input name="costPerUnit" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Opening stock"><input name="openingStock" type="number" step="0.001" defaultValue="0" /></Field><Field label="Reorder level"><input name="reorderLevel" type="number" step="0.001" defaultValue="0" /></Field><Field label="Notes"><textarea name="notes" placeholder="Optional production or listing note" /></Field><FormMessage error={error} /><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save SKU'}</Button></div></form></Modal>
}

function MaterialForm({ onClose, onComplete }: { onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); await api('/api/catalog/materials', { method: 'POST', body: JSON.stringify({ materialCode: form.get('materialCode'), materialName: form.get('materialName'), category: form.get('category'), unit: form.get('unit'), openingStock: form.get('openingStock'), reorderLevel: form.get('reorderLevel'), avgUnitCost: form.get('avgUnitCost'), preferredVendor: form.get('preferredVendor'), notes: form.get('notes') }) }); await onComplete('Material saved.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save material.') } finally { setSaving(false) } }
  return <Modal title="Add material" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Material code"><input name="materialCode" required placeholder="JAR-100" /></Field><Field label="Material name"><input name="materialName" required placeholder="100g glass jar" /></Field><Field label="Category"><input name="category" placeholder="Packaging" /></Field><Field label="Unit"><input name="unit" defaultValue="pcs" /></Field><Field label="Opening stock"><input name="openingStock" type="number" step="0.001" defaultValue="0" /></Field><Field label="Reorder level"><input name="reorderLevel" type="number" step="0.001" defaultValue="0" /></Field><Field label="Average unit cost"><input name="avgUnitCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field><Field label="Preferred vendor"><input name="preferredVendor" placeholder="Optional" /></Field><Field label="Notes"><textarea name="notes" placeholder="Optional material note" /></Field><FormMessage error={error} /><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save material'}</Button></div></form></Modal>
}

function OrderForm({ skus, onClose, onComplete }: { skus: Row[]; onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); const sku = skus.find((item) => item.id === form.get('skuId')); await api('/api/orders', { method: 'POST', body: JSON.stringify({ orderDate: form.get('orderDate'), platform: sku?.platform || 'Offline', orderId: form.get('orderId'), skuId: form.get('skuId'), qtyOrdered: form.get('qtyOrdered'), qtyDelivered: form.get('qtyDelivered'), qtyReturned: form.get('qtyReturned'), salePrice: form.get('salePrice'), status: form.get('status'), deliveryDate: form.get('deliveryDate'), returnDate: form.get('returnDate'), refundAmount: form.get('refundAmount'), customerLocation: form.get('customerLocation'), notes: form.get('notes') }) }); await onComplete('Order recorded and inventory ledger updated.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save order.') } finally { setSaving(false) } }
  return <Modal title="Record order" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Order date"><input name="orderDate" type="date" defaultValue={toDateInput(new Date())} /></Field><Field label="Order ID"><input name="orderId" required placeholder="Order-1024" /></Field><Field label="SKU"><select name="skuId" required defaultValue=""><option value="" disabled>Select a product</option>{skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.product_name} · {sku.sku_code}</option>)}</select></Field><Field label="Status"><select name="status"><option>Delivered</option><option>Pending</option><option>Shipped</option><option>Cancelled</option><option>Returned</option></select></Field><Field label="Quantity ordered"><input name="qtyOrdered" type="number" min="0" step="0.001" defaultValue="1" /></Field><Field label="Quantity delivered"><input name="qtyDelivered" type="number" min="0" step="0.001" defaultValue="1" /></Field><Field label="Quantity returned"><input name="qtyReturned" type="number" min="0" step="0.001" defaultValue="0" /></Field><Field label="Unit sale price"><input name="salePrice" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Delivery date"><input name="deliveryDate" type="date" defaultValue={toDateInput(new Date())} /></Field><Field label="Return date"><input name="returnDate" type="date" /></Field><Field label="Refund amount"><input name="refundAmount" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Customer location"><input name="customerLocation" placeholder="Lucknow, Uttar Pradesh" /></Field><Field label="Notes"><textarea name="notes" placeholder="Optional order note" /></Field><FormMessage error={error} />{!skus.length ? <p className="form-error">Add an SKU before recording an order.</p> : null}<div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" className="primary" disabled={saving || !skus.length}>{saving ? 'Saving…' : 'Save order'}</Button></div></form></Modal>
}

function AdjustmentForm({ materials, onClose, onComplete }: { materials: Row[]; onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); await api('/api/inventory/material-transactions', { method: 'POST', body: JSON.stringify({ materialId: form.get('materialId'), txnDate: form.get('txnDate'), txnType: form.get('txnType'), qtyIn: form.get('qtyIn'), qtyOut: form.get('qtyOut'), unitCost: form.get('unitCost'), reference: form.get('reference'), notes: form.get('notes') }) }); await onComplete('Material adjustment added.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to adjust stock.') } finally { setSaving(false) } }
  return <Modal title="Adjust material stock" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Material"><select name="materialId" required defaultValue=""><option disabled value="">Select material</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.material_name} · {material.material_code}</option>)}</select></Field><Field label="Date"><input name="txnDate" type="date" defaultValue={toDateInput(new Date())} /></Field><Field label="Movement"><select name="txnType"><option>ADJUSTMENT</option><option>OPENING_CORRECTION</option><option>WASTE</option></select></Field><Field label="Stock in"><input name="qtyIn" type="number" min="0" step="0.001" defaultValue="0" /></Field><Field label="Stock out"><input name="qtyOut" type="number" min="0" step="0.001" defaultValue="0" /></Field><Field label="Unit cost"><input name="unitCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field><Field label="Reference"><input name="reference" placeholder="Stock count August" /></Field><Field label="Notes"><textarea name="notes" /></Field><FormMessage error={error} /><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button className="primary" type="submit" disabled={saving || !materials.length}>{saving ? 'Saving…' : 'Save adjustment'}</Button></div></form></Modal>
}

function SupplierForm({ onClose, onComplete }: { onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); await api('/api/suppliers', { method: 'POST', body: JSON.stringify({ supplierName: form.get('supplierName'), address: form.get('address'), gstin: form.get('gstin'), phone: form.get('phone'), email: form.get('email'), defaultGstRate: form.get('defaultGstRate'), defaultTransportCost: form.get('defaultTransportCost'), notes: form.get('notes') }) }); await onComplete('Supplier saved.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save supplier.') } finally { setSaving(false) } }
  return <Modal title="Add supplier" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Supplier name"><input name="supplierName" required placeholder="Supplier company" /></Field><Field label="GSTIN"><input name="gstin" placeholder="Optional" /></Field><Field label="Phone"><input name="phone" type="tel" /></Field><Field label="Email"><input name="email" type="email" /></Field><Field label="Default GST %"><input name="defaultGstRate" type="number" min="0" step="0.001" defaultValue="0" /></Field><Field label="Default transport cost"><input name="defaultTransportCost" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Address"><textarea name="address" /></Field><Field label="Notes"><textarea name="notes" /></Field><FormMessage error={error} /><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save supplier'}</Button></div></form></Modal>
}

function PurchaseForm({ materials, onClose, onComplete }: { materials: Row[]; onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [suppliers, setSuppliers] = useState<Row[]>([]); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  useEffect(() => { void api<Row[]>('/api/suppliers').then(setSuppliers).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load suppliers.')) }, [])
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); await api('/api/purchases', { method: 'POST', body: JSON.stringify({ purchaseDate: form.get('purchaseDate'), supplierId: form.get('supplierId'), materialId: form.get('materialId'), quantity: form.get('quantity'), unit: form.get('unit'), unitPrice: form.get('unitPrice'), gstRate: form.get('gstRate'), transportCost: form.get('transportCost'), invoiceNo: form.get('invoiceNo'), notes: form.get('notes') }) }); await onComplete('Purchase saved and material stock increased.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save purchase.') } finally { setSaving(false) } }
  return <Modal title="Record purchase" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Purchase date"><input name="purchaseDate" type="date" defaultValue={toDateInput(new Date())} /></Field><Field label="Invoice number"><input name="invoiceNo" placeholder="INV-204" /></Field><Field label="Supplier"><select name="supplierId" required defaultValue=""><option disabled value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>)}</select></Field><Field label="Material"><select name="materialId" required defaultValue=""><option disabled value="">Select material</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.material_name}</option>)}</select></Field><Field label="Quantity"><input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" /></Field><Field label="Unit"><input name="unit" defaultValue="pcs" /></Field><Field label="Unit price"><input name="unitPrice" type="number" min="0" step="0.0001" defaultValue="0" /></Field><Field label="GST %"><input name="gstRate" type="number" min="0" step="0.001" defaultValue="0" /></Field><Field label="Transport cost"><input name="transportCost" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Notes"><textarea name="notes" /></Field><FormMessage error={error} />{!suppliers.length ? <p className="form-error">Add a supplier before recording a purchase.</p> : null}<div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button className="primary" type="submit" disabled={saving || !suppliers.length || !materials.length}>{saving ? 'Saving…' : 'Save purchase'}</Button></div></form></Modal>
}

function ExpenseForm({ onClose, onComplete }: { onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); await api('/api/expenses', { method: 'POST', body: JSON.stringify({ expenseDate: form.get('expenseDate'), category: form.get('category'), amount: form.get('amount'), description: form.get('description'), platform: form.get('platform') }) }); await onComplete('Expense recorded.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save expense.') } finally { setSaving(false) } }
  return <Modal title="Add operating expense" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Date"><input name="expenseDate" type="date" defaultValue={toDateInput(new Date())} /></Field><Field label="Category"><select name="category">{appConfig.expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Amount"><input name="amount" type="number" min="0.01" step="0.01" defaultValue="0" /></Field><Field label="Platform"><select name="platform"><option value="">All / general</option>{appConfig.supportedPlatforms.map((platform) => <option key={platform}>{platform}</option>)}</select></Field><Field label="Description"><textarea name="description" placeholder="What was this for?" /></Field><FormMessage error={error} /><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save expense'}</Button></div></form></Modal>
}

function BorrowingForm({ onClose, onComplete }: { onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(''); try { const form = new FormData(event.currentTarget); await api('/api/borrowings', { method: 'POST', body: JSON.stringify({ direction: form.get('direction'), txnDate: form.get('txnDate'), counterparty: form.get('counterparty'), itemType: form.get('itemType'), itemCode: form.get('itemCode'), itemName: form.get('itemName'), quantity: form.get('quantity'), unitCost: form.get('unitCost'), dueDate: form.get('dueDate'), notes: form.get('notes') }) }); await onComplete('Borrow/lend record saved.') } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save record.') } finally { setSaving(false) } }
  return <Modal title="Borrow or lend material" onClose={onClose}><form onSubmit={submit} className="form-grid"><Field label="Direction"><select name="direction"><option value="borrowed">Borrowed from someone</option><option value="lent">Lent to someone</option></select></Field><Field label="Date"><input name="txnDate" type="date" defaultValue={toDateInput(new Date())} /></Field><Field label="Counterparty"><input name="counterparty" required placeholder="Friend or company" /></Field><Field label="Item type"><input name="itemType" defaultValue="Material" /></Field><Field label="Item code"><input name="itemCode" /></Field><Field label="Item name"><input name="itemName" required /></Field><Field label="Quantity"><input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" /></Field><Field label="Unit cost"><input name="unitCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field><Field label="Due date"><input name="dueDate" type="date" /></Field><Field label="Notes"><textarea name="notes" /></Field><FormMessage error={error} /><div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save record'}</Button></div></form></Modal>
}

function ImportsView({ onComplete }: { onComplete: (message: string) => Promise<void> }) {
  const [rows, setRows] = useState<RawRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [platform, setPlatform] = useState<PlatformType>('Amazon')
  const [detection, setDetection] = useState<DocumentAnalysis | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [history, setHistory] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [templates, setTemplates] = useState<Array<{
    id: string
    name: string
    platform: PlatformType
    docType: string
    columnMapping: ImportMapping
    isDefault: boolean
    usageCount: number
  }>>([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  // Multi-sheet support
  const [allSheets, setAllSheets] = useState<Array<{
    sheetName: string
    platform: PlatformType
    docType: DocumentType
    docTypeName: string
    rowCount: number
    confidence: number
    relationship: 'orders' | 'returns' | 'settlement' | 'standalone'
    isPrimary: boolean
    mergeWith: string[]
    headers: string[]
    rows: RawRow[]
    mapping: ImportMapping
    entityType: string
    entityConfidence: number
    targetTable: string
    normalizedRows?: RawRow[]
  }>>([])
  const [selectedSheetName, setSelectedSheetName] = useState<string>('')
  const [warnings, setWarnings] = useState<string[]>([])

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<Row[]>('/api/imports'))
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to load import history.')
    }
  }, [])

  const loadTemplates = useCallback(async () => {
    try {
      const data = await api<Array<{
        id: string
        name: string
        platform: PlatformType
        doc_type: string
        column_mapping: ImportMapping
        is_default: boolean
        usage_count: number
      }>>('/api/import-templates')
      setTemplates((data || []).map(t => ({
        id: t.id,
        name: t.name,
        platform: t.platform,
        docType: t.doc_type,
        columnMapping: t.column_mapping,
        isDefault: t.is_default,
        usageCount: t.usage_count,
      })))
    } catch {
      // Templates are optional
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    void loadTemplates()
  }, [loadHistory, loadTemplates])

  const missingRequired = importFields.filter((field) => field.required && !mapping[field.id])

  const applyTemplate = useCallback((template: typeof templates[0]) => {
    if (!template) return
    setMapping(template.columnMapping || {})
    setPlatform(template.platform)
    setActiveTemplateId(template.id)
    setMessage(`Applied template: ${template.name}`)
  }, [])

  const saveAsTemplate = async () => {
    if (Object.keys(mapping).length === 0) {
      setMessage('No mapping to save.')
      return
    }
    const name = window.prompt('Enter template name:', `${platform} Import Template`)
    if (!name) return
    
    try {
      const result = await api<Row>('/api/import-templates', {
        method: 'POST',
        body: JSON.stringify({
          name,
          platform,
          docType: detection?.docType,
          columnMapping: mapping,
          fileNamePattern: fileName ? fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : undefined,
          sheetNamePattern: selectedSheetName ? selectedSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : undefined,
          headerRowIndex: detection?.headerRowIndex,
        }),
      })
      await loadTemplates()
      setMessage(`Saved template: ${name}`)
      setShowTemplateModal(false)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Failed to save template.')
    }
  }

  const deleteTemplate = async (id: string) => {
    if (!window.confirm('Delete this template?')) return
    try {
      await api('/api/import-templates', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      })
      await loadTemplates()
      setMessage('Template deleted.')
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Failed to delete template.')
    }
  }

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    setBusy(true)
    setMessage('Analyzing document structure and auto-detecting platform…')
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/imports/parse-file', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to parse file.')

      // Handle multi-sheet results
      if (data.allSheets && data.allSheets.length > 0) {
        setAllSheets(data.allSheets)
        setWarnings(data.warnings || [])
        
        // Auto-select primary sheet
        const primary = data.allSheets.find((s: any) => s.isPrimary) || data.allSheets[0]
        setSelectedSheetName(primary.sheetName)
        setRows(primary.rows || [])
        setHeaders(primary.headers || [])
        setMapping(primary.mapping || {})
        setPlatform(primary.platform)
        
        const detectionResult = {
          docType: primary.docType,
          docTypeName: primary.docTypeName,
          detectedPlatform: primary.platform,
          confidence: primary.confidence,
          isValidOrderDoc: primary.rowCount > 0 && primary.headers.length > 0,
          validationSummary: primary.rowCount > 0 ? 'Valid order document detected.' : 'No data rows found.',
          recommendedMapping: primary.mapping,
          selectedSheet: primary.sheetName,
          sheetNames: data.allSheets.map((s: any) => s.sheetName),
          headerRowIndex: 0,
          aiMappingUsed: Object.keys(primary.mapping).length > 0,
        }
        setDetection(detectionResult)
      } else {
        // Legacy single-sheet response
        setAllSheets([])
        setRows(data.rows || [])
        setHeaders(data.headers || [])
        setMapping(data.mapping || {})
        setDetection(data.detection || null)
        if (data.detection?.detectedPlatform) {
          setPlatform(data.detection.detectedPlatform)
        }
      }

      setFileName(data.fileName || file.name)

      const matchInfo = detection
        ? `Detected ${detection.docTypeName} (${detection.detectedPlatform}) with ${detection.confidence}% confidence.`
        : 'File analyzed successfully.'

      const totalRows = data.totalRows || (data.rows || []).length
      setMessage(`${totalRows.toLocaleString()} rows extracted · ${matchInfo}`)
    } catch (caught) {
      setRows([])
      setHeaders([])
      setMapping({})
      setDetection(null)
      setAllSheets([])
      setFileName('')
      setMessage(caught instanceof Error ? caught.message : 'Unable to read this report.')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  const switchSheet = (sheet: typeof allSheets[0]) => {
    setSelectedSheetName(sheet.sheetName)
    setRows(sheet.rows || [])
    setHeaders(sheet.headers || [])
    setMapping(sheet.mapping || {})
    setPlatform(sheet.platform)
    setDetection({
      docType: sheet.docType,
      docTypeName: sheet.docTypeName,
      detectedPlatform: sheet.platform,
      confidence: sheet.confidence,
      isValidOrderDoc: sheet.rowCount > 0 && sheet.headers.length > 0,
      validationSummary: sheet.rowCount > 0 ? 'Valid order document detected.' : 'No data rows found.',
      recommendedMapping: sheet.mapping,
      selectedSheet: sheet.sheetName,
      sheetNames: allSheets.map(s => s.sheetName),
      headerRowIndex: 0,
      aiMappingUsed: Object.keys(sheet.mapping).length > 0,
    })
    setMessage(`Switched to sheet: ${sheet.sheetName} (${sheet.rowCount.toLocaleString()} rows)`)
  }

  const importRows = async () => {
    if (missingRequired.length) {
      setMessage(`Map required fields first: ${missingRequired.map((field) => field.label).join(', ')}.`)
      return
    }

    setBusy(true)
    try {
      const result = await api<Row>('/api/imports', {
        method: 'POST',
        body: JSON.stringify({ platform, sourceFile: fileName, rows, mapping }),
      })
      const parts = [
        `Imported ${result.importedRows}`,
        `skipped ${result.duplicateRows} duplicates`,
        `${result.unmatchedRows} unmatched`,
      ]
      if (Number(result.createdSkus) > 0) parts.push(`auto-created ${result.createdSkus} SKUs`)
      if (Number(result.errorRows) > 0) parts.push(`${result.errorRows} row errors`)
      setMessage(parts.join('; ') + '.')
      setRows([])
      setHeaders([])
      setMapping({})
      setDetection(null)
      setAllSheets([])
      setFileName('')
      await loadHistory()
      await onComplete(`Marketplace report imported successfully into ${platform}.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  // Multi-entity import - imports all detected sheets to their respective tables
  const importAllEntities = async () => {
    if (allSheets.length === 0) {
      setMessage('No sheets to import. Please upload a file first.')
      return
    }

    // Check if any sheet has missing required mappings
    const sheetsWithMissing = allSheets.filter(sheet => {
      const sheetMapping = sheet.mapping || {}
      return importFields.some(field => field.required && !sheetMapping[field.id])
    })

    if (sheetsWithMissing.length > 0) {
      setMessage(`Some sheets have missing required mappings. Please review each sheet's mapping.`)
      return
    }

    setBusy(true)
    try {
      // Prepare sheets for multi-entity import
      const sheetsToImport = allSheets.map(sheet => ({
        entityType: sheet.entityType,
        platform: sheet.platform,
        rows: sheet.normalizedRows || sheet.rows,
        mapping: sheet.mapping,
        sheetName: sheet.sheetName,
        targetTable: sheet.targetTable,
      }))

      type MultiEntityResult = {
        totalImported: number
        totalSheets: number
        totalErrors: number
        sheetResults: Record<string, { imported: number; errors: number; duplicates: number; created: number }>
      }
      const result = await api<MultiEntityResult>('/api/imports/multi-entity', {
        method: 'POST',
        body: JSON.stringify({ sheets: sheetsToImport, fileName }),
      })

      const parts = [
        `Imported ${result.totalImported} records across ${result.totalSheets} sheets`,
      ]
      if (result.totalErrors > 0) parts.push(`${result.totalErrors} errors`)

      // Show per-sheet results
      for (const [sheetName, sheetResult] of Object.entries(result.sheetResults)) {
        const detail = [
          sheetResult.imported > 0 && `${sheetResult.imported} imported`,
          sheetResult.duplicates > 0 && `${sheetResult.duplicates} duplicates`,
          sheetResult.created > 0 && `${sheetResult.created} created`,
          sheetResult.errors > 0 && `${sheetResult.errors} errors`,
        ].filter(Boolean).join(', ')
        if (detail) parts.push(`${sheetName}: ${detail}`)
      }

      setMessage(parts.join('; ') + '.')
      setRows([])
      setHeaders([])
      setMapping({})
      setDetection(null)
      setAllSheets([])
      setFileName('')
      await loadHistory()
      await onComplete(`Multi-entity import completed: ${result.totalImported} records imported.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Multi-entity import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeading
        eyebrow="Marketplace reports"
        title="Intelligent Document Ingestion."
        detail="Upload Excel, CSV, TSV, or PDF invoice files. Platform and document type are detected automatically, missing SKUs are created silently, and duplicate line items are skipped. Multi-sheet workbooks are intelligently parsed."
      />
      
      {/* Template Bar */}
      {(templates.length > 0 || Object.keys(mapping).length > 0) && (
        <article className="panel template-bar">
          <div className="template-bar-header">
            <p className="eyebrow">Import Templates</p>
            <h3>Reuse saved mappings</h3>
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <button
                key={template.id}
                className={`template-chip ${activeTemplateId === template.id ? 'active' : ''} ${template.isDefault ? 'default' : ''}`}
                onClick={() => applyTemplate(template)}
                disabled={busy}
              >
                <span>{template.name}</span>
                <small>{template.platform}</small>
                {template.isDefault && <span className="default-badge">Default</span>}
                <small className="usage">Used {template.usageCount}x</small>
              </button>
            ))}
            {Object.keys(mapping).length > 0 && !activeTemplateId && (
              <button className="template-chip save-template" onClick={() => setShowTemplateModal(true)} disabled={busy}>
                <span>Save current as template</span>
              </button>
            )}
          </div>
        </article>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <article className="panel warnings-panel">
          <p className="eyebrow">⚠ Notes</p>
          <ul>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </article>
      )}

      <section className="import-grid">
        <article className="panel import-drop">
          <p className="eyebrow">Step 1</p>
          <h2>Choose or drop document</h2>
          <p className="muted">Supports Excel (.xlsx, .xls), CSV, TSV, Text, or PDF Invoices. Multi-sheet workbooks auto-detected.</p>
          <div className="file-picker">
            <input id="report-file" type="file" accept=".csv,.xls,.xlsx,.tsv,.txt,.pdf,text/csv,application/pdf" onChange={readFile} disabled={busy} />
            <label htmlFor="report-file">{busy ? 'Analyzing document…' : 'Select or drop report file (Excel, CSV, PDF)'}</label>
          </div>

          {/* Multi-sheet selector */}
          {allSheets.length > 1 && (
            <div className="sheet-selector">
              <p className="eyebrow">Detected Sheets ({allSheets.length})</p>
              <div className="sheet-tabs">
                {allSheets.map((sheet) => (
                  <button
                    key={sheet.sheetName}
                    className={`sheet-tab ${selectedSheetName === sheet.sheetName ? 'active' : ''} ${sheet.relationship} entity-${sheet.entityType}`}
                    onClick={() => switchSheet(sheet)}
                    disabled={busy}
                  >
                    <span className="sheet-name">{sheet.sheetName}</span>
                    <span className={`entity-badge entity-${sheet.entityType}`}>{sheet.entityType}</span>
                    <span className="sheet-meta">
                      {sheet.rowCount.toLocaleString()} rows · {sheet.entityConfidence}% · {sheet.relationship}
                    </span>
                    {sheet.isPrimary && <span className="primary-badge">Primary</span>}
                    {sheet.mergeWith.length > 0 && <span className="merge-badge">Merged: {sheet.mergeWith.join(', ')}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Multi-entity import button */}
          {allSheets.length > 0 && (
            <div className="multi-entity-import-bar">
              <span className="import-summary">
                Ready to import <strong>{allSheets.length}</strong> sheet(s) to <strong>{[...new Set(allSheets.map(s => s.entityType))].join(', ')}</strong> table(s)
              </span>
              <Button 
                className="primary wide" 
                disabled={busy} 
                onClick={() => void importAllEntities()}
              >
                {busy ? 'Importing All Entities…' : `Import All Entities (${allSheets.reduce((sum, s) => sum + s.rowCount, 0).toLocaleString()} rows)`}
              </Button>
            </div>
          )}

          {detection ? (
            <div className={`detection-card ${detection.isValidOrderDoc ? 'verified' : 'warning'}`}>
              <div className="detection-head">
                <span className="detection-title">{detection.docTypeName}</span>
                <span className="detection-pill">{detection.confidence}% Match</span>
              </div>
              <p className="detection-summary">
                {detection.isValidOrderDoc ? '✓ ' : '⚠ '}
                {detection.validationSummary}
              </p>
            </div>
          ) : null}

          <Field label="Assigned Platform" hint="Auto-detected from document contents (override if needed)">
            <select value={platform} onChange={(event) => setPlatform(event.target.value as PlatformType)} disabled={busy}>
              {appConfig.supportedPlatforms.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          {fileName ? <p className="import-message">File: <b>{fileName}</b></p> : null}
          {selectedSheetName && allSheets.length > 0 && <p className="import-message">Sheet: <b>{selectedSheetName}</b></p>}
          {message ? <p className="import-message">{message}</p> : null}
        </article>

        <article className="panel">
          <p className="eyebrow">Step 2</p>
          <h2>Review verified field mapping</h2>
          {rows.length ? (
            <>
              <div className="mapping-list editable">
                {importFields.map((field) => (
                  <label key={field.id} className="mapping-row">
                    <span>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </span>
                    <select
                      value={mapping[field.id] || ''}
                      onChange={(event) => setMapping((current) => ({ ...current, [field.id]: event.target.value || undefined }))}
                      disabled={busy}
                    >
                      <option value="">Not mapped</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {missingRequired.length ? (
                <p className="form-error">Required before import: {missingRequired.map((field) => field.label).join(', ')}.</p>
              ) : (
                <p className="muted" style={{ marginTop: '8px' }}>
                  Ready to ingest. Unknown SKUs will be automatically cataloged for <b>{platform}</b>.
                </p>
              )}
              <div className="form-actions">
                <Button className="primary wide" disabled={busy || missingRequired.length > 0} onClick={() => void importRows()}>
                  {busy ? 'Importing…' : `Import ${rows.length.toLocaleString()} rows into ${platform}`}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState title="Awaiting a report" detail="Upload any sales spreadsheet or PDF invoice to preview extraction and column mapping." />
          )}
        </article>
      </section>

      {/* Template Modal */}
      {showTemplateModal && (
        <Modal title="Save as Import Template" onClose={() => setShowTemplateModal(false)}>
          <form onSubmit={(e) => { e.preventDefault(); saveAsTemplate() }} className="form-grid">
            <Field label="Template name">
              <input name="templateName" defaultValue={`${platform} Import Template`} required />
            </Field>
            <Field label="Platform">
              <select name="templatePlatform" defaultValue={platform} disabled>
                {appConfig.supportedPlatforms.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="Document type">
              <input name="docType" defaultValue={detection?.docTypeName || ''} placeholder="Auto-detected" />
            </Field>
            <div className="form-actions">
              <Button type="button" onClick={() => setShowTemplateModal(false)}>Cancel</Button>
              <Button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</Button>
            </div>
          </form>
        </Modal>
      )}

      <article className="panel history-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2>Recent imports</h2>
          </div>
        </div>
        <DataTable
          rows={history}
          empty="No report imports yet"
          columns={[
            {
              label: 'File',
              value: (row) => (
                <>
                  <strong>{row.file_name}</strong>
                  <small>
                    {row.platform} · {new Date(row.imported_at).toLocaleString('en-IN')}
                  </small>
                </>
              ),
            },
            { label: 'Imported', value: (row) => formatNumber(row.imported_rows) },
            { label: 'Duplicates', value: (row) => formatNumber(row.duplicate_rows) },
            { label: 'Unmatched', value: (row) => formatNumber(row.unmatched_rows) },
            { label: 'Errors', value: (row) => formatNumber(row.error_rows) },
          ]}
        />
      </article>
    </>
  )
}

function SettingsView({ onComplete }: { onComplete: (message: string) => Promise<void> }) {
  const [workspace, setWorkspace] = useState<Row | null>(null); const [integrations, setIntegrations] = useState<Row>({}); const [message, setMessage] = useState(''); const [scope, setScope] = useState('all'); const [confirmation, setConfirmation] = useState('')
  const load = useCallback(async () => { try { const [nextWorkspace, nextIntegrations] = await Promise.all([api<Row>('/api/workspace'), api<Row>('/api/integrations')]); setWorkspace(nextWorkspace); setIntegrations(nextIntegrations) } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Unable to load workspace settings.') } }, [])
  useEffect(() => { void load() }, [load])
  const saveWorkspace = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); try { const form = new FormData(event.currentTarget); await api('/api/workspace', { method: 'PATCH', body: JSON.stringify({ businessName: form.get('businessName'), defaultCurrency: form.get('currency') }) }); await onComplete('Workspace settings saved.'); await load() } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Unable to save settings.') } }
  const exportData = async () => { try { const payload = await api<{ datasets: Record<string, Row[]> }>('/api/export', { method: 'POST', body: JSON.stringify({}) }); const XLSX = await import('xlsx'); const workbook = XLSX.utils.book_new(); Object.entries(payload.datasets).forEach(([name, data]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), name.slice(0, 31))); XLSX.writeFile(workbook, `peak-business-export-${toDateInput(new Date())}.xlsx`); setMessage('Export downloaded.') } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Export failed.') } }
  const deleteData = async () => { const phrase = scope === 'all' ? 'DELETE EVERYTHING' : `DELETE ${scope.replace('_', ' ').toUpperCase()}`; if (confirmation !== phrase) { setMessage(`Enter exactly: ${phrase}`); return } if (!window.confirm('This permanently deletes the selected business data. Continue?')) return; try { await api('/api/danger-zone', { method: 'DELETE', body: JSON.stringify({ scope, confirmation }) }); setConfirmation(''); setMessage('Data deleted.'); await onComplete('Selected data was deleted.') } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Delete failed.') } }
  return <><SectionHeading eyebrow="Workspace controls" title="Your data, portable." detail="Manage the operational profile, download a full export, and keep an eye on integration readiness." /><section className="settings-grid"><article className="panel"><p className="eyebrow">Workspace</p><h2>Business profile</h2><form className="form-grid compact" onSubmit={saveWorkspace}><Field label="Business name"><input name="businessName" defaultValue={workspace?.business_name || ''} /></Field><Field label="Currency"><select name="currency" defaultValue={workspace?.default_currency || 'INR'}><option>INR</option><option>USD</option><option>EUR</option></select></Field><div className="form-actions"><Button className="primary" type="submit">Save profile</Button></div></form></article><article className="panel"><p className="eyebrow">Integration health</p><h2>Private configuration</h2><div className="integration-list">{Object.entries(integrations).map(([name, value]) => <div key={name}><span>{name}</span><b className={(value as Row).configured ? 'ready' : 'not-ready'}>{(value as Row).configured ? 'Configured' : 'Needs key'}</b></div>)}</div><small className="muted">Credentials stay in one local `.env.local` file and Cloudflare secrets in production.</small></article></section><section className="settings-grid"><article className="panel"><p className="eyebrow">Portability</p><h2>Full data export</h2><p className="muted">Download every business dataset in one Excel workbook whenever you need an independent backup.</p><Button className="primary" onClick={() => void exportData()}>Download Excel export</Button><Button onClick={replayTour}>Replay intro tour</Button></article><article className="panel danger-panel"><p className="eyebrow">Danger zone</p><h2>Delete business data</h2><p className="muted">This cannot be undone. Export first if you may need a record.</p><select value={scope} onChange={(event) => { setScope(event.target.value); setConfirmation('') }}><option value="all">Everything</option><option value="orders">Orders</option><option value="skus">SKUs</option><option value="materials">Materials</option><option value="purchases">Purchases</option><option value="suppliers">Suppliers</option><option value="borrowings">Borrow / lend</option><option value="expenses">Expenses</option><option value="import_history">Import history</option></select><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={scope === 'all' ? 'DELETE EVERYTHING' : `DELETE ${scope.replace('_', ' ').toUpperCase()}`} /><Button className="danger" onClick={() => void deleteData()}>Permanently delete</Button></article></section>{message ? <p className="settings-message">{message}</p> : null}</>
}
