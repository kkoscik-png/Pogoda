const HOUR=3600000, RETAIN=48*HOUR;

// Keep the last successful response across hour boundaries and Worker instances.
export function createLastGoodCache({now=()=>Date.now(),cache=null}={}){
 const memory=new Map(),pending=new Map(),storage=()=>cache||(typeof caches!=='undefined'?caches.default:null);
 const usable=value=>value?.records?.some(r=>r.hourly?.time?.some((t,i)=>t>=Math.floor(now()/HOUR)*3600-3600&&Number.isFinite((r.hourly.wind_speed_10m||r.hourly.wave_height||[])[i])));
 return async function lastGood(key,load,fallback=null){
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{
   const store=storage(),request=new Request('https://weather.seasync.co/__dmi_last_good/v1/'+encodeURIComponent(key));
   let old=memory.get(key);if(!old&&store){const hit=await store.match(request);if(hit)old=await hit.json();}
   if(old&&now()-old.saved<HOUR&&usable(old))return old;
   let value;
   try{value=await load();}
   catch(error){
    if(old&&now()-old.saved<RETAIN&&usable(old))return {...old,stale:true,checkedAt:now(),notice:'Ostatnia dobra prognoza — może być nieaktualna.'};
    if(!fallback)throw error;
    value=await fallback(error);
   }
   if(!usable(value))throw Error('Brak użytecznych danych prognozy DMI.');
   value={...value,saved:value.saved??now(),checkedAt:now(),stale:false};
   if(memory.size>=180)memory.delete(memory.keys().next().value);memory.set(key,value);
   if(store)await store.put(request,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+RETAIN/1000}}));
   return value;
  })().finally(()=>pending.delete(key));pending.set(key,job);return job;
 };
}

export function normalizeDMIOpenMeteo(data,points,fetchedAt=Date.now()){
 const rows=Array.isArray(data)?data:[data];if(rows.length!==points.length)throw Error('Niepełna prognoza zapasowa Open-Meteo.');
 const fields=['temperature_2m','wind_speed_10m','wind_gusts_10m','wind_direction_10m','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','precipitation'];
 const records=rows.map((row,i)=>{
  const source=row.hourly;if(!Array.isArray(source?.time)||row.hourly_units?.wind_speed_10m!=='m/s')throw Error('Nieprawidłowa prognoza zapasowa Open-Meteo.');
  const hourly={time:source.time.map(t=>Number.isFinite(t)?t:null)};
  for(const field of fields)hourly[field]=source.time.map((_,i)=>{
   const v=source[field]?.[i];if(typeof v!=='number'||!Number.isFinite(v))return null;
   if(field==='temperature_2m')return v;
   return v>=0&&v<=(field.startsWith('cloud_cover')?100:field==='wind_direction_10m'?360:Infinity)?v:null;
  });
  if(!hourly.wind_speed_10m.some(v=>v!==null))throw Error('Brak wiatru w prognozie zapasowej Open-Meteo.');
  return {id:points[i].id,latitude:row.latitude,longitude:row.longitude,provider:'DMI / ECMWF via Open-Meteo',model:'DMI Seamless (DMI + ECMWF)',hourly};
 });
 return {records,saved:fetchedAt,timing:{updatedAt:new Date(fetchedAt).toISOString(),nextUpdate:new Date(fetchedAt+HOUR).toISOString(),referenceTime:null,basis:'fetch',estimated:true},delivery:'open-meteo',blend:true,notice:'Źródło zapasowe: Open-Meteo · DMI Seamless (DMI + ECMWF).',attribution:'DMI, ECMWF / Open-Meteo, CC BY 4.0'};
}
