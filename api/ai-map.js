export const access="user";
export const methods=["POST"];
const fields={order_id:"Marketplace order identifier",sku_code:"Marketplace SKU/product code",order_date:"Date of the order or sale",qty_ordered:"Quantity ordered",qty_delivered:"Quantity delivered/shipped/fulfilled",qty_returned:"Returned quantity",sale_price:"Per-unit selling price or item value",status:"Order status",delivery_date:"Delivery/fulfillment date",return_date:"Return date",refund_amount:"Refund amount",customer_location:"Customer city/state/location"};
export default async function(req,res){
  const b=req.body||{};
  if(!Array.isArray(b.headers)||!Array.isArray(b.samples))return res.status(400).json({error:"headers and samples are required"});
  const key=process.env.OPENROUTER_API_KEY;
  if(!key)return res.status(503).json({error:"OpenRouter is not configured",setup_required:true,message:"Add OPENROUTER_API_KEY in the Hatchable project setup gate."});
  const prompt=`You are the ecommerce report column-mapping engine. Map source spreadsheet columns to these canonical fields: ${JSON.stringify(fields)}. Prefer exact semantic matches over totals or derived values. Never invent a source column. Return ONLY JSON with shape {"fields": {canonical: {"source_column": string|null, "confidence": number, "reason": string}}, "warnings": string[]}. Use confidence 0..1. Source headers: ${JSON.stringify(b.headers)}. Sample rows: ${JSON.stringify(b.samples.slice(0,5))}`;
  try{
    const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key,"HTTP-Referer":"https://business-ops-saas.hatchable.site","X-Title":"Business Ops SaaS"},body:JSON.stringify({model:"openrouter/free",messages:[{role:"system",content:"You output strict JSON only."},{role:"user",content:prompt}],temperature:0,max_tokens:1800})});
    const raw=await r.text();let data={};try{data=JSON.parse(raw)}catch{}
    if(!r.ok)return res.status(502).json({error:"OpenRouter request failed",detail:data?.error?.message||raw.slice(0,500)});
    const text=data?.choices?.[0]?.message?.content||"";
    const clean=text.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim();
    const parsed=JSON.parse(clean);
    return res.json({...parsed,provider:"openrouter",model:data?.model||"openrouter/free"});
  }catch(e){return res.status(502).json({error:"AI mapping unavailable",detail:e.message})}
}