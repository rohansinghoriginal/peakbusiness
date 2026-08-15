export const access="public";
export const methods=["GET"];
export default async function(req,res){res.json({ok:true,service:'business-ops',version:'6.0',timestamp:new Date().toISOString()});}