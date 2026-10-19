import { STORMGLASS_POINTS } from './stormglass-points.mjs';
import { FORECAST_GRIDS } from './forecast-points.mjs';
import { loadCopernicus, copernicusDataset } from './copernicus.mjs';
const HOUR=3600000, BATCH=6;
const SOURCES={fmi_wam:{interval:6*HOUR},dmi_wam:{interval:6*HOUR,collection:'wam_nsb'},dmi_harmonie:{interval:3*HOUR,collection:'harmonie_dini_sf'},copernicus_baltic:{interval:12*HOUR}};
const METADATA={ecmwf_ifs:['https://api.open-meteo.com','ecmwf_ifs'],icon_eu:['https://api.open-meteo.com','dwd_icon_eu'],icon_global:['https://api.open-meteo.com','dwd_icon'],ecmwf_wam:['https://marine-api.open-meteo.com','ecmwf_wam'],dwd_ewam:['https://marine-api.open-meteo.com','dwd_ewam']};
const GROUPS={ports:STORMGLASS_POINTS.ports,route:STORMGLASS_POINTS.route,'wind-grid':FORECAST_GRIDS.windGrid.map((p,i)=>({...p,id:String(i)})),'wave-grid':FORECAST_GRIDS.waveGrid.map((p,i)=>({...p,id:String(i)}))};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const numeric=(x,max=Infinity)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max?x:null;
const iso=x=>Number.isFinite(x)?new Date(x).toISOString():null;
export function modelTiming(updatedAt,interval,referenceTime=null,basis='publication') {
  const t=Date.parse(updatedAt);return {updatedAt:Number.isFinite(t)?iso(t):null,referenceTime,nextUpdate:Number.isFinite(t)?iso(t+interval):null,basis,estimated:true};
}
function dmiTiming(referenceTime,model){
  const timing=modelTiming(referenceTime,SOURCES[model].interval,referenceTime,'reference');
  // DMI documents +2h45m from cycle start to complete surface/WAM data.
  timing.nextUpdate=iso(Date.parse(referenceTime)+SOURCES[model].interval+165*60000);return timing;
}
export function normalizeFMI(xml,points) {
  if (xml.includes('ExceptionReport')) throw Error('FMI odrzuciło zapytanie');
  const records=points.map(p=>({id:p.id,latitude:p.lat,longitude:p.lon,provider:'FMI',model:'WAM',hourly:{time:[],wave_height:[],wave_direction:[],wave_period:[]}}));
  const rows=points.map(()=>new Map()),fields={SigWaveHeight:'wave_height',WaveDirection:'wave_direction',WavePeriod:'wave_period'};
  let updatedAt=null,referenceTime=null;
  for(const match of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
    const member=match[1],pos=member.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/)?.[1]?.trim().split(/\s+/).map(Number);
    const field=fields[member.match(/observableProperty=forecast[^"<>]*?param=([^&"<>]+)/)?.[1]];
    if(!pos||!field)continue;
    const i=points.findIndex(p=>Math.abs(p.lat-pos[0])<0.0001&&Math.abs(p.lon-pos[1])<0.0001);if(i<0)continue;
    const resultTime=member.match(/<om:resultTime>([\s\S]*?)<\/om:resultTime>/)?.[1]?.match(/<gml:timePosition[^>]*>([^<]+)/)?.[1];
    const analysis=member.match(/<om:parameter>([\s\S]*?)<\/om:parameter>/g)?.find(s=>s.includes('analysisTime'))?.match(/<gml:timePosition[^>]*>([^<]+)/)?.[1];
    if(resultTime&&(!updatedAt||Date.parse(resultTime)<Date.parse(updatedAt)))updatedAt=resultTime;
    if(analysis)referenceTime=analysis;
    for(const pair of member.matchAll(/<wml2:MeasurementTVP>([\s\S]*?)<\/wml2:MeasurementTVP>/g)) {
      const time=Date.parse(pair[1].match(/<wml2:time>([^<]+)/)?.[1])/1000,raw=pair[1].match(/<wml2:value[^>]*>([^<]+)/)?.[1];
      if(!Number.isFinite(time))continue;if(!rows[i].has(time))rows[i].set(time,{});
      rows[i].get(time)[field]=raw?.trim()?numeric(Number(raw),field==='wave_direction'?360:Infinity):null;
    }
  }
  records.forEach((r,i)=>{for(const [t,values] of [...rows[i]].sort((a,b)=>a[0]-b[0])){r.hourly.time.push(t);for(const key of Object.values(fields))r.hourly[key].push(values[key]??null);}});
  if(!records.some(r=>r.hourly.time.length))throw Error('Brak danych FMI');
  return {records,timing:modelTiming(updatedAt,6*HOUR,referenceTime),attribution:'Finnish Meteorological Institute, CC BY 4.0'};
}
export function normalizeDMI(data,points,model,referenceTime) {
  const axes=data.domain?.axes,range=data.ranges;if(!axes?.t?.values||!range)throw Error('Nieprawidłowa prognoza DMI');
  const fields=model==='dmi_wam'?{'significant-wave-height':'wave_height','mean-wave-dir':'wave_direction','mean-wave-period':'wave_period'}:{'wind-speed-10m':'wind_speed_10m','wind-dir-10m':'wind_direction_10m','gust-wind-speed-10m':'wind_gusts_10m','fraction-of-cloud-cover':'cloud_cover','high-cloud-cover':'cloud_cover_high','medium-cloud-cover':'cloud_cover_mid','low-cloud-cover':'cloud_cover_low'};
  const xs=axes.x?.values,ys=axes.y?.values;if(!xs?.length||!ys?.length)throw Error('Brak siatki DMI');
  const nearest=(arr,v)=>arr.reduce((best,x,i)=>Math.abs(x-v)<Math.abs(arr[best]-v)?i:best,0);
  const records=points.map(p=>{
    let x=nearest(xs,p.lon),y=nearest(ys,p.lat);
    const read=(key,t,xx=x,yy=y)=>{const r=range[key];if(!r)return null;let index=0;for(let j=0;j<r.axisNames.length;j++)index=index*r.shape[j]+({t,x:xx,y:yy}[r.axisNames[j]]??0);return numeric(r.values[index],key.includes('dir')?360:Infinity);};
    if(model==='dmi_wam'&&read('significant-wave-height',0)===null){let best=Infinity;for(let yy=Math.max(0,y-2);yy<=Math.min(ys.length-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(xs.length-1,x+2);xx++){const d=(xs[xx]-p.lon)**2*Math.cos(p.lat*Math.PI/180)**2+(ys[yy]-p.lat)**2;if(d<best&&read('significant-wave-height',0,xx,yy)!==null){best=d;x=xx;y=yy;}}}
    const hourly={time:axes.t.values.map(t=>Date.parse(t)/1000)};for(const [field,key] of Object.entries(fields))hourly[key]=axes.t.values.map((_,t)=>{const v=read(field,t);return key==='cloud_cover'?numeric(v===null?null:v*100,100):key.startsWith('cloud_cover_')?numeric(v,100):v;});
    if(model==='dmi_harmonie')hourly.precipitation=axes.t.values.map((_,t)=>{if(!t||hourly.time[t]-hourly.time[t-1]!==3600)return null;const a=read('total-precipitation',t-1),b=read('total-precipitation',t);return a!==null&&b!==null&&b>=a?b-a:null;});
    return {id:p.id,latitude:ys[y],longitude:xs[x],provider:'DMI',model:model==='dmi_wam'?'WAM NSB':'HARMONIE DINI',referenceTime,hourly};
  });
  return {records,timing:dmiTiming(referenceTime,model),attribution:'Danish Meteorological Institute, CC BY 4.0'};
}
export function createForecastAPI({fetcher=(...args)=>fetch(...args),now=()=>Date.now(),cache=null}={}) {
  const memory=new Map(),pending=new Map();
  async function cached(key,ttl,load,ctx={}) {
    const old=memory.get(key);if(old&&now()-old.saved<ttl*1000)return old.value;
    const storage=cache||(typeof caches!=='undefined'?caches.default:null),request=new Request('https://weather.seasync.co/__forecast_cache/v5/'+encodeURIComponent(key));
    if(storage&&ttl){const hit=await storage.match(request);if(hit){const value=await hit.json();memory.set(key,{saved:now(),value});return value;}}
    if(!pending.has(key))pending.set(key,(async()=>{const value=await load();if(ttl){if(memory.size>180)memory.delete(memory.keys().next().value);memory.set(key,{saved:now(),value});if(storage){const task=storage.put(request,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}}));if(ctx.waitUntil)ctx.waitUntil(task);else await task;}}return value;})().finally(()=>pending.delete(key)));
    return pending.get(key);
  }
  async function response(url) {const r=await fetcher(url,{signal:AbortSignal.timeout(35000),headers:{Accept:'application/json, application/xml, */*'}});if(!r.ok){const e=Error('Źródło chwilowo niedostępne ('+r.status+')');e.status=r.status;throw e;}return r;}
  const getJSON=(url,ttl=300)=>cached(url,ttl,async()=>await(await response(url)).json());
  const getBuffer=async url=>await(await response(url)).arrayBuffer();
  async function fetchModel(model,points,group) {
    // Match the shared UI axis: previous full hour through 71 hours ahead.
    const start=iso(Math.floor(now()/HOUR)*HOUR-(model==='dmi_harmonie'?2:1)*HOUR),end=iso(Math.floor(now()/HOUR)*HOUR+71*HOUR);
    if(model==='copernicus_baltic')return loadCopernicus(points,{getJSON,getBuffer,now:now()});
    if(model==='fmi_wam'){
      // The documented stored query accepts one location. Repeated latlon
      // parameters are not reliably honoured, so fetch every point explicitly.
      // Harbour samples use verified nearby sea positions, disclosed in the UI.
      const sea={0:{lat:57.437578,lon:21.525557},1:{lat:57.398842,lon:21.466607},2:{lat:58.909033,lon:18.034752}};
      const results=[];
      for(let offset=0;offset<points.length;offset+=2){
        results.push(...await Promise.all(points.slice(offset,offset+2).map(async p=>{
          const sample=group==='ports'?{...p,...sea[p.id]}:p;
          const url=new URL('https://opendata.fmi.fi/wfs');url.search=new URLSearchParams({service:'WFS',version:'2.0.0',request:'getFeature',storedquery_id:'fmi::forecast::wam::point::timevaluepair',parameters:'SigWaveHeight,WaveDirection,WavePeriod',starttime:start,endtime:end,timestep:'60',latlon:sample.lat+','+sample.lon});
          const result=normalizeFMI(await(await response(url.href)).text(),[sample]);if(group==='ports')result.records[0].coordinateType='sea-query';return result;
        })));
      }
      const timing=results.map(r=>r.timing).sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))[0];
      return {records:results.flatMap(r=>r.records),timing,attribution:'Finnish Meteorological Institute, CC BY 4.0'};
    }
    const collection=SOURCES[model].collection,root='https://opendataapi.dmi.dk/v1/forecastedr/collections/'+collection;
    const runs=await getJSON(root+'/instances',300),instance=[...runs.instances].sort((a,b)=>b.id.localeCompare(a.id))[0];if(!instance)throw Error('Brak cyklu DMI');
    const referenceTime=instance.id.replace(/T(\d{2})(\d{2})(\d{2})Z$/,'T$1:$2:$3Z');
    const fields=model==='dmi_wam'?'significant-wave-height,mean-wave-dir,mean-wave-period':'wind-speed-10m,wind-dir-10m,gust-wind-speed-10m'+(group==='ports'?',fraction-of-cloud-cover,high-cloud-cover,medium-cloud-cover,low-cloud-cover,total-precipitation':'');
    const max=Date.parse(instance.extent.temporal.interval[0][1]),limit=iso(Math.min(Date.parse(end),max));
    const records=[];
    // Distant app samples must not request a giant rectangular 2-km wind grid.
    // Small fixed-point requests stay below EDR's payload and Worker limits.
    for(const p of points){
      const sea=model==='dmi_wam'&&group==='ports';
      const query={crs:'crs84','parameter-name':fields,datetime:start+'/'+limit};
      if(sea)query.bbox=[p.lon-.12,p.lat-.08,p.lon+.12,p.lat+.08].join(',');else query.coords='POINT('+p.lon+' '+p.lat+')';
      const url=root+'/instances/'+instance.id+'/'+(sea?'cube':'position')+'?'+new URLSearchParams(query);
      let data;try{data=await(await response(url)).json();}catch(e){if(e.status!==429)throw e;await new Promise(resolve=>setTimeout(resolve,1200));data=await(await response(url)).json();}
      records.push(...normalizeDMI(data,[p],model,referenceTime).records);
    }
    return {records,timing:dmiTiming(referenceTime,model),attribution:'Danish Meteorological Institute, CC BY 4.0'};
  }
  return async function handleForecast(request,env,ctx={}) {
    const u=new URL(request.url);if(!['/api/forecast','/api/model-updates'].includes(u.pathname))return null;
    if(request.method!=='GET')return json({error:'Metoda niedozwolona.'},405);
    const model=u.searchParams.get('model');
    if(u.pathname==='/api/model-updates'){
      if(model==='dmi_harmonie'||model==='dmi_wam'){
        try{const root='https://opendataapi.dmi.dk/v1/forecastedr/collections/'+SOURCES[model].collection;const runs=await getJSON(root+'/instances',300),instance=[...runs.instances].sort((a,b)=>b.id.localeCompare(a.id))[0];const referenceTime=instance.id.replace(/T(\d{2})(\d{2})(\d{2})Z$/,'T$1:$2:$3Z');return json({timing:dmiTiming(referenceTime,model),checkedAt:iso(now())});}catch{return json({error:'Czas aktualizacji DMI chwilowo niedostępny.'},502);}
      }
      if(model==='copernicus_baltic'){
        try{const d=await copernicusDataset(getJSON,now());return json({timing:modelTiming(d.properties.admp_updated_data||d.properties.admp_updated,12*HOUR),checkedAt:iso(now())});}catch{return json({error:'Czas aktualizacji Copernicus chwilowo niedostępny.'},502);}
      }
      if(!METADATA[model])return json({error:'Nieznany model.'},400);
      try{const [host,id]=METADATA[model],data=await getJSON(host+'/data/'+id+'/static/meta.json',300);return json({timing:modelTiming(iso(data.last_run_availability_time*1000),data.update_interval_seconds*1000,iso(data.last_run_initialisation_time*1000)),checkedAt:iso(now())});}catch{return json({error:'Czas aktualizacji chwilowo niedostępny.'},502);}
    }
    const group=u.searchParams.get('group')||'ports',text=u.searchParams.get('offset')||'0',points=GROUPS[group];
    if(!SOURCES[model]||!points||!/^\d+$/.test(text))return json({error:'Nieprawidłowy model lub grupa.'},400);
    const offset=Number(text);if(offset%BATCH||offset>=points.length||(group==='ports'&&offset))return json({error:'Nieprawidłowy zakres.'},400);
    const selected=points.slice(offset,offset+BATCH),key=[model,group,offset,Math.floor(now()/HOUR)].join('/');
    try {
      const payload=await cached(key,model==='dmi_harmonie'?900:1800,async()=>({...await fetchModel(model,selected,group),saved:now()}),ctx);
      return json({...payload,model,group,total:points.length,nextOffset:offset+selected.length<points.length?offset+selected.length:null});
    }catch(e){return json({error:e.status===429?'Dostawca jest zajęty. Ponów pobieranie za chwilę.':'Nie udało się pobrać modelu '+model+'.',model},e.status===429?429:502);}
  };
}
export const handleForecast=createForecastAPI();
