import { db } from "hatchable";
export const access="user";
export const methods=["GET","POST","PUT"];
export default async function(req,res){
 const owner=req.user.id;
 if(req.method==="GET"){const {rows}=await db.query(`SELECT b.*,ROUND((b.qty-b.qty_returned)*b.unit_cost,2) AS outstanding_value,ROUND(b.qty-b.qty_returned,3) AS outstanding_qty,CASE WHEN b.qty-b.qty_returned<=0 THEN 'Closed' ELSE b.settlement_status END AS computed_status FROM borrowings b WHERE b.created_by=$1 ORDER BY b.txn_date DESC`,[owner]);return res.json(rows);}
 const b=req.body||{};
 if(!b.counterparty||!b.item_name) return res.status(400).json({error:"Counterparty and item name are required"});
 if(req.method==="POST"){
  const {rows}=await db.query(`INSERT INTO borrowings (created_by,direction,txn_date,counterparty,item_type,item_code,item_name,qty,unit_cost,qty_returned,due_date,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[owner,b.direction||"borrowed",b.txn_date||new Date().toISOString().slice(0,10),b.counterparty,b.item_type||"Material",b.item_code||null,b.item_name,Number(b.qty||0),Number(b.unit_cost||0),Number(b.qty_returned||0),b.due_date||null,b.notes||null]);
  return res.json(rows[0]);
 }
 if(!b.id) return res.status(400).json({error:"id is required"});
 const {rows}=await db.query(`UPDATE borrowings SET qty_returned=$1,return_date=$2,settlement_status=$3,notes=$4,updated_at=now() WHERE id=$5 AND created_by=$6 RETURNING *`,[Number(b.qty_returned||0),b.return_date||null,b.settlement_status||"Open",b.notes||null,b.id,owner]);
 res.json(rows[0]||null);
}