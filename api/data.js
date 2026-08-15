import { db } from "hatchable";

export const access = "user";
export const methods = ["GET"];

export default async function (req, res) {
  const owner = req.user.id;
  const [skuQ, materialQ, orderQ, borrowQ, expenseQ, dashboardQ, revenueQ, materialUsageQ] = await Promise.all([
    db.query(`SELECT s.id, s.sku_code, s.product_name, s.category, s.platform, s.selling_price, s.cost_per_unit, s.opening_stock, s.reorder_level, s.active, s.notes,
      ROUND(s.opening_stock + COALESCE(SUM(st.qty_in - st.qty_out),0), 2) AS current_stock,
      ROUND((s.opening_stock + COALESCE(SUM(st.qty_in - st.qty_out),0)) * s.cost_per_unit, 2) AS stock_value,
      ROUND(s.selling_price - s.cost_per_unit, 2) AS profit_per_unit,
      CASE WHEN (s.opening_stock + COALESCE(SUM(st.qty_in - st.qty_out),0)) <= s.reorder_level THEN 'REORDER' ELSE 'OK' END AS stock_alert
      FROM skus s LEFT JOIN sku_transactions st ON st.sku_id=s.id AND st.created_by=$1
      WHERE s.created_by=$1 GROUP BY s.id ORDER BY s.active DESC, s.product_name`, [owner]),
    db.query(`SELECT m.id, m.material_code, m.material_name, m.category, m.unit, m.opening_stock, m.reorder_level, m.avg_unit_cost, m.preferred_vendor, m.notes,
      ROUND(m.opening_stock + COALESCE(SUM(mt.qty_in - mt.qty_out),0), 3) AS current_stock,
      ROUND((m.opening_stock + COALESCE(SUM(mt.qty_in - mt.qty_out),0)) * m.avg_unit_cost, 2) AS stock_value,
      CASE WHEN (m.opening_stock + COALESCE(SUM(mt.qty_in - mt.qty_out),0)) <= m.reorder_level THEN 'REORDER' ELSE 'OK' END AS stock_alert
      FROM materials m LEFT JOIN material_transactions mt ON mt.material_id=m.id AND mt.created_by=$1
      WHERE m.created_by=$1 GROUP BY m.id ORDER BY m.material_name`, [owner]),
    db.query(`SELECT o.id, o.order_date, o.platform, o.order_id, o.sku_id, s.sku_code, s.product_name, o.qty_ordered, o.qty_delivered, o.qty_returned,
      o.sale_price, ROUND(o.qty_ordered*o.sale_price,2) AS revenue, ROUND(o.qty_delivered*s.cost_per_unit,2) AS total_cogs,
      ROUND(o.qty_ordered*o.sale_price-o.refund_amount-o.qty_delivered*s.cost_per_unit,2) AS gross_profit,
      o.status, o.delivery_date, o.return_date, o.customer_location, o.refund_amount, o.notes
      FROM business_orders o JOIN skus s ON s.id=o.sku_id WHERE o.created_by=$1 ORDER BY o.order_date DESC, o.created_at DESC LIMIT 100`, [owner]),
    db.query(`SELECT b.*, ROUND((b.qty-b.qty_returned)*b.unit_cost,2) AS outstanding_value, ROUND(b.qty-b.qty_returned,3) AS outstanding_qty,
      CASE WHEN b.qty-b.qty_returned <= 0 THEN 'Closed' ELSE b.settlement_status END AS computed_status
      FROM borrowings b WHERE b.created_by=$1 ORDER BY CASE WHEN b.qty-b.qty_returned > 0 THEN 0 ELSE 1 END, b.txn_date DESC`, [owner]),
    db.query(`SELECT * FROM business_expenses WHERE created_by=$1 ORDER BY expense_date DESC, created_at DESC LIMIT 100`, [owner]),
    db.query(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.qty_delivered),0) AS units_delivered,
      COALESCE(SUM(o.qty_returned),0) AS units_returned, COALESCE(SUM(o.qty_ordered*o.sale_price),0) AS revenue,
      COALESCE(SUM(o.refund_amount),0) AS refunds, COALESCE(SUM(o.qty_delivered*s.cost_per_unit),0) AS cogs,
      COALESCE(SUM(o.qty_ordered*o.sale_price-o.refund_amount-o.qty_delivered*s.cost_per_unit),0) AS gross_profit
      FROM business_orders o JOIN skus s ON s.id=o.sku_id WHERE o.created_by=$1`, [owner]),
    db.query(`SELECT o.order_date AS day, ROUND(SUM(o.qty_ordered*o.sale_price-o.refund_amount),2) AS revenue
      FROM business_orders o WHERE o.created_by=$1 AND o.order_date >= current_date - interval '13 days'
      GROUP BY o.order_date ORDER BY o.order_date`, [owner]),
    db.query(`SELECT mt.txn_date AS day, m.material_name, m.unit, ROUND(SUM(mt.qty_out),3) AS qty_out
      FROM material_transactions mt JOIN materials m ON m.id=mt.material_id
      WHERE mt.created_by=$1 AND mt.txn_date >= current_date - interval '13 days'
      GROUP BY mt.txn_date, m.material_name, m.unit ORDER BY mt.txn_date, m.material_name`, [owner])
  ]);
  const outstanding = await db.query(`SELECT direction, ROUND(COALESCE(SUM((qty-qty_returned)*unit_cost),0),2) AS value, ROUND(COALESCE(SUM(qty-qty_returned),0),3) AS qty FROM borrowings WHERE created_by=$1 GROUP BY direction`, [owner]);
  res.json({ skus: skuQ.rows, materials: materialQ.rows, orders: orderQ.rows, borrowings: borrowQ.rows, expenses: expenseQ.rows, dashboard: dashboardQ.rows[0], revenueTrend: revenueQ.rows, materialUsage: materialUsageQ.rows, borrowingSummary: outstanding.rows });
}