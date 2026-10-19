// Shared server-only Stormglass adapter. No API key is ever returned to the browser.
import { STORMGLASS_POINTS } from './stormglass-points.mjs';
const TTL=6*3600,SOURCE='sg';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function normalizeStormglass(data,point,saved){
 if(!Array.isArray(data.hours)||!data.hours.length)throw new Error('invalid response');
 const rows=data.hours.filter(r=>Number.isFinite(Date.parse(r.time))).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 if(!rows.length)throw new Error('invalid timestamps');
 const value=(row,key,max=Infinity)=>{const raw=row[key]?.[SOURCE];if(raw===null||raw===undefined||raw===''||!['number','string'].includes(typeof raw))return null;const n=Number(raw);return Number.isFinite(n)&&n>=0&&n<=max?n:null;};
 return {latitude:point.lat,longitude:point.lon,provider:'Stormglass',source:SOURCE,saved,hourly:{time:rows.map(r=>Date.parse(r.time)/1000),wave_height:rows.map(r=>value(r,'waveHeight')),wave_direction:rows.map(r=>value(r,'waveDirection',360)),wave_period:rows.map(r=>value(r,'wavePeriod'))}};
}
export function createStormglassAPI({fetcher=(...args)=>fetch(...args),cache=null,now=()=>Date.now()}={}){
 const inflight=new Map(),memory=new Map();
 return async function handleStormglass(request,env,ctx={}){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/stormglass/'))return null;
  if(request.method!=='GET')return json({error:'Metoda niedozwolona.'},405);
  const configured=typeof env.STORMGLASS_API_KEY==='string'&&env.STORMGLASS_API_KEY.trim().length>0,routeEnabled=env.STORMGLASS_ROUTE_ENABLED==='true';
  if(url.pathname==='/api/stormglass/status')return json({configured,routeEnabled:configured&&routeEnabled,source:SOURCE,cacheHours:6});
  if(url.pathname!=='/api/stormglass/waves')return json({error:'Nieznany adres API.'},404);
  if(!configured)return json({error:'Dodaj sekret STORMGLASS_API_KEY w Cloudflare.'},503);
  const group=url.searchParams.get('group')||'ports',offsetText=url.searchParams.get('offset')||'0';
  if(!['ports','route'].includes(group)||!/^\d+$/.test(offsetText))return json({error:'Nieprawidłowa grupa punktów.'},400);
  if(group==='route'&&!routeEnabled)return json({error:'Stormglass dla trasy nie jest włączony. Wymaga STORMGLASS_ROUTE_ENABLED=true.'},403);
  const all=STORMGLASS_POINTS[group],offset=Number(offsetText);if(offset>=all.length||(group==='ports'&&offset!==0)||offset%5!==0)return json({error:'Nieprawidłowy zakres punktów.'},400);
  const activeCache=cache||(typeof caches!=='undefined'?caches.default:null),points=all.slice(offset,offset+5);let records=[];
  try{records=await Promise.all(points.map(async point=>{
   const key=new Request(url.origin+'/__stormglass_cache/v1/'+group+'/'+point.id);
   const local=memory.get(key.url);if(local&&now()-local.saved<TTL*1000)return local;
   let hit=null;if(activeCache){try{hit=await activeCache.match(key)}catch{}}
   if(hit){const record=await hit.json();memory.set(key.url,record);return record;}
   const cacheKey=key.url;
   if(!inflight.has(cacheKey))inflight.set(cacheKey,(async()=>{
    const start=Math.floor(now()/86400000)*86400,end=start+5*86400;
    const target=new URL('https://api.stormglass.io/v2/weather/point');target.search=new URLSearchParams({lat:point.lat,lng:point.lon,params:'waveHeight,waveDirection,wavePeriod',source:SOURCE,start,end}).toString();
    const response=await fetcher(target.toString(),{headers:{Authorization:env.STORMGLASS_API_KEY},signal:AbortSignal.timeout(25000)});
    if(!response.ok){const error=new Error('upstream');error.status=response.status;throw error;}
    const record={id:point.id,...normalizeStormglass(await response.json(),point,now())};
    memory.set(key.url,record);if(activeCache){const cached=new Response(JSON.stringify(record),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+TTL}});try{await activeCache.put(key,cached)}catch{};}
    return record;
   })().finally(()=>inflight.delete(cacheKey)));
   return inflight.get(cacheKey);
  }));}catch(error){console.warn('stormglass_adapter',error.name,error.status||0,String(error.message||'').replace(env.STORMGLASS_API_KEY,'[redacted]'));const status=error.status===429?429:error.status===401||error.status===403?502:502;return json({error:error.status===429?'Limit zapytań Stormglass został osiągnięty.':error.status===401||error.status===403?'Stormglass odrzucił klucz lub uprawnienia.':'Nie udało się pobrać prognozy Stormglass.'},status);}
  const saved=Math.min(...records.map(r=>r.saved)),refreshAfter=new Date(saved+TTL*1000).toISOString();
  return json({records,saved,refreshAfter,timing:{updatedAt:new Date(saved).toISOString(),nextUpdate:refreshAfter,basis:'fetch',estimated:true},source:SOURCE,group,nextOffset:offset+points.length<all.length?offset+points.length:null,total:all.length,cacheHours:6});
 };
}
export const handleStormglass=createStormglassAPI();
