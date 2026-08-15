import { db } from "hatchable";
export const access="user";
export const methods=["GET","POST"];
export default async function(req,res){
 const owner=req.user.id;
 if(req.method==="GET"){
  const skuId=req.query?.sku_id;
  if(!skuId) return res.status(400).json({error:"sku_id is required"});
  const {rows}=await db.query(`SELECT sm.id,sm.sku_id,sm.material_id,m.material_code,m.material_name,m.unit,sm.qty_per_unit,sm.waste_pct FROM sku_materials sm JOIN materials m ON m.id=sm.material_id WHERE sm.created_by=$1 AND sm.sku_id=$2 ORDER BY m.material_name`,[owner,skuId]);
  return res.json(rows);
 }
 const b=req.body||{};
 if(!b.sku_id) return res.status(400).json({error:"sku_id is required"});
 await db.query(`DELETE FROM sku_materials WHERE created_by=$1 AND sku_id=$2`,[owner,b.sku_id]);
 for(const line of Array.isArray(b.lines)?b.lines:[]) {
  if(!line.material_id||Number(line.qty_per_unit||0)<=0) continue;
  await db.query(`INSERT INTO sku_materials (created_by,sku_id,material_id,qty_per_unit,waste_pct) VALUES ($1,$2,$3,$4,$5)`,[owner,b.sku_id,line.material_id,Number(line.qty_per_unit),Number(line.waste_pct||0)]);
 }
 const {rows}=await db.query(`SELECT sm.id,sm.material_id,m.material_code,m.material_name,m.unit,sm.qty_per_unit,sm.waste_pct FROM sku_materials sm JOIN materials m ON m.id=sm.material_id WHERE sm.created_by=$1 AND sm.sku_id=$2 ORDER BY m.material_name`,[owner,b.sku_id]);
 res.json(rows);
}