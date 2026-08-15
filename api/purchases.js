import { db } from "hatchable";
export const access="member";
export const methods=["GET","POST"];
export default async function(req,res){
  const owner=req.member.id;
  if(req.method==="GET"){
    const {rows}=await db.query(`SELECT p.*,s.supplier_name,s.address,s.gstin,m.material_code,m.material_name FROM material_purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN materials m ON m.id=p.material_id WHERE p.created_by=$1 ORDER BY p.purchase_date DESC,p.created_at DESC LIMIT 300`,[owner]);
    return res.json(rows);
  }
  const b=req.body||{};
  if(!b.supplier_id||!b.material_id||!b.quantity)return res.status(400).json({error:"Supplier, material and quantity are required"});
  const qty=Number(b.quantity||0), unitPrice=Number(b.unit_price||0), subtotal=Math.round(qty*unitPrice*100)/100, gstRate=Number(b.gst_rate||0), gstAmount=Math.round(subtotal*gstRate/100*100)/100, transport=Number(b.transport_cost||0), total=Math.round((subtotal+gstAmount+transport)*100)/100;
  const {rows}=await db.query(`INSERT INTO material_purchases(created_by,purchase_date,supplier_id,material_id,quantity,unit,unit_price,subtotal,gst_rate,gst_amount,transport_cost,total_amount,invoice_no,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(created_by,invoice_no,material_id) DO UPDATE SET purchase_date=EXCLUDED.purchase_date,quantity=EXCLUDED.quantity,unit=EXCLUDED.unit,unit_price=EXCLUDED.unit_price,subtotal=EXCLUDED.subtotal,gst_rate=EXCLUDED.gst_rate,gst_amount=EXCLUDED.gst_amount,transport_cost=EXCLUDED.transport_cost,total_amount=EXCLUDED.total_amount,notes=EXCLUDED.notes RETURNING *`,[owner,b.purchase_date||new Date().toISOString().slice(0,10),b.supplier_id,b.material_id,qty,b.unit||"pcs",unitPrice,subtotal,gstRate,gstAmount,transport,total,b.invoice_no||null,b.notes||null]);
  const purchase=rows[0];
  if(purchase.invoice_no) await db.query(`DELETE FROM material_transactions WHERE created_by=$1 AND material_id=$2 AND source='PURCHASE' AND reference=$3`,[owner,purchase.material_id,purchase.invoice_no]);
  await db.query(`INSERT INTO material_transactions(created_by,txn_date,material_id,txn_type,qty_in,unit_cost,reference,source,notes) VALUES($1,$2,$3,'PURCHASE_IN',$4,$5,$6,'PURCHASE',$7)`,[owner,purchase.purchase_date,purchase.material_id,qty,unitPrice,purchase.invoice_no||null,purchase.notes||null]);
  res.json({...purchase,computed_subtotal:subtotal,computed_gst:gstAmount,computed_total:total});
}