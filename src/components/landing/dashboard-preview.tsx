const metrics = [
  { label: 'Net profit', value: '₹1,84,320', tone: 'positive', note: 'Revenue less COGS & expenses' },
  { label: 'Revenue', value: '₹6,52,800', tone: 'default', note: '1,248 units delivered' },
  { label: 'Material value', value: '₹2,91,460', tone: 'warm', note: 'Current stock valuation' },
  { label: 'Restock watch', value: '3', tone: 'alert', note: 'SKUs and materials at threshold' },
]

const bars = [
  { label: '03-12', value: 38 },
  { label: '03-13', value: 52 },
  { label: '03-14', value: 44 },
  { label: '03-15', value: 68 },
  { label: '03-16', value: 61 },
  { label: '03-17', value: 84 },
  { label: '03-18', value: 72 },
]

const restock = [
  { item: 'Cotton drawstring pouch', meta: 'SKU · PB-SKU-0084', onHand: '4', threshold: '20' },
  { item: 'Kraft shipping box L', meta: 'Material · PB-MAT-0003', onHand: '12', threshold: '50' },
  { item: 'Printed polybag M', meta: 'Material · PB-MAT-0011', onHand: '9', threshold: '40' },
]

const orders = [
  { id: 'PB-0004821', platform: 'Amazon', product: 'Linen tote bag', value: '₹2,149' },
  { id: 'PB-0004819', platform: 'Meesho', product: 'Cotton pouch set', value: '₹899' },
  { id: 'PB-0004817', platform: 'Flipkart', product: 'Jute basket', value: '₹1,599' },
]

export function DashboardPreview() {
  return (
    <div className="dash-mock" aria-label="Preview of the Peak Business operations dashboard">
      <div className="dash-mock__topbar">
        <div className="dash-mock__brand">
          <span className="dash-mock__mark">PB</span>
          <span>Operations workspace</span>
        </div>
        <div className="dash-mock__tabs">
          <span className="active">Overview</span>
          <span>Orders</span>
          <span>Analytics</span>
          <span>Catalog</span>
        </div>
        <span className="dash-mock__avatar" aria-hidden="true" />
      </div>

      <div className="dash-mock__body">
        <div className="dash-mock__heading">
          <div>
            <p className="eyebrow">Command center</p>
            <h3>Keep the business moving.</h3>
          </div>
          <div className="dash-mock__actions">
            <span>+ Record order</span>
            <span className="primary">Import sales</span>
          </div>
        </div>

        <div className="dash-mock__metrics">
          {metrics.map((metric) => (
            <div className={`dash-mock__metric ${metric.tone}`} key={metric.label}>
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <small>{metric.note}</small>
            </div>
          ))}
        </div>

        <div className="dash-mock__grid">
          <div className="dash-mock__panel">
            <div className="dash-mock__panel-title">
              <div>
                <p className="eyebrow">Momentum</p>
                <h4>Recent sales</h4>
              </div>
              <span>Last activity</span>
            </div>
            <div className="dash-mock__chart">
              {bars.map((bar) => (
                <div className="dash-mock__bar" key={bar.label}>
                  <div className="dash-mock__bar-fill" style={{ height: `${bar.value}%` }} />
                  <small>{bar.label}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="dash-mock__panel">
            <div className="dash-mock__panel-title">
              <div>
                <p className="eyebrow">Attention queue</p>
                <h4>Restock signals</h4>
              </div>
              <span>3 open</span>
            </div>
            <div className="dash-mock__table">
              <div className="dash-mock__row dash-mock__row-head">
                <span>Item</span>
                <span>On hand</span>
                <span>Threshold</span>
              </div>
              {restock.map((row) => (
                <div className="dash-mock__row" key={row.item}>
                  <span><strong>{row.item}</strong><small>{row.meta}</small></span>
                  <span>{row.onHand}</span>
                  <span>{row.threshold}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-mock__panel">
          <div className="dash-mock__panel-title">
            <div>
              <p className="eyebrow">Freshest activity</p>
              <h4>Latest orders</h4>
            </div>
            <span>View all</span>
          </div>
          <div className="dash-mock__table">
            <div className="dash-mock__row dash-mock__row-head">
              <span>Order</span>
              <span>Product</span>
              <span>Value</span>
            </div>
            {orders.map((row) => (
              <div className="dash-mock__row" key={row.id}>
                <span><strong>{row.id}</strong><small>{row.platform}</small></span>
                <span>{row.product}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}