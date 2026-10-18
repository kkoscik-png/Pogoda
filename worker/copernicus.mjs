import { bloscReader } from './blosc.mjs';
const PRODUCT = 'BALTICSEA_ANALYSISFORECAST_WAV_003_010';
const ROOT = 'https://stac.marine.copernicus.eu/metadata/' + PRODUCT + '/';
const FIELDS = { VHM0: 'wave_height', VMDR: 'wave_direction', VTPK: 'wave_period' };
export async function copernicusDataset(getJSON, now) {
  const catalog = await getJSON(ROOT + 'product.stac.json', 1800);
  const items = catalog.links.filter(l => l.rel === 'item' && /cmems_mod_bal_wav_anfc_PT1H-i_\d+\/dataset/.test(l.href));
  const versions = await Promise.all(items.map(l => getJSON(new URL(l.href, ROOT).href, 1800)));
  const active = versions.filter(d => Date.parse(d.properties?.admp_released_date || '2000-01-01') <= now && Date.parse(d.properties?.admp_retired_date || '2100-01-01') > now);
  active.sort((a,b) => Date.parse(b.properties.admp_released_date) - Date.parse(a.properties.admp_released_date));
  const dataset = active[0]; if (!dataset?.assets?.geoChunked) throw Error('Brak aktywnego zbioru Copernicus');
  return dataset;
}
export async function loadCopernicus(points, { getJSON, getBuffer, now }) {
  const dataset = await copernicusDataset(getJSON, now), asset = dataset.assets.geoChunked, root = asset.href + '/';
  const meta = (await getJSON(root + '.zmetadata', 1800)).metadata, dims = asset.viewDims;
  const axes = {};
  for (const axis of ['latitude', 'longitude']) {
    const a = meta[axis + '/.zarray'], reader = bloscReader(await getBuffer(root + axis + '/0', 86400));
    axes[axis] = Array.from({length:a.shape[0]}, (_,i) => reader.number(i));
  }
  const start = Math.ceil(now / 3600000) * 3600000, times = Array.from({length:72}, (_,i) => start / 1000 + i * 3600);
  const t0 = Math.round((start - dims.time.coords.min) / 3600000);
  const nearest = (values, x) => values.reduce((best,v,i) => Math.abs(v-x) < Math.abs(values[best]-x) ? i : best, 0);
  const locations = points.map(p => ({...p, x:nearest(axes.longitude,p.lon), y:nearest(axes.latitude,p.lat)}));
  const records = locations.map(p => ({id:p.id,latitude:axes.latitude[p.y],longitude:axes.longitude[p.x],provider:'Copernicus Marine / FMI',model:'Baltic WAM',hourly:{time:times, wave_height:times.map(()=>null),wave_direction:times.map(()=>null),wave_period:times.map(()=>null)}}));
  for (const [field,key] of Object.entries(FIELDS)) {
    const array = meta[field + '/.zarray'];
    if (!array || array.dtype !== '<f4' || array.order !== 'C' || array.compressor?.id !== 'blosc' || array.compressor.cname !== 'lz4' || array.filters?.length) throw Error('Nieobsługiwany format Copernicus');
    const [ct,cy,cx] = array.chunks, groups = new Map();
    locations.forEach((p,i) => times.forEach((_,j) => {
      const t = t0+j; if (t < 0 || t >= array.shape[0]) return;
      const chunk = [Math.floor(t/ct),Math.floor(p.y/cy),Math.floor(p.x/cx)].join('.');
      if (!groups.has(chunk)) groups.set(chunk, []); groups.get(chunk).push({i,j,index:(t%ct)*cy*cx+(p.y%cy)*cx+(p.x%cx)});
    }));
    const chunks=[...groups];
    for(let batch=0;batch<chunks.length;batch+=3)await Promise.all(chunks.slice(batch,batch+3).map(async ([chunk,targets]) => {
      const reader = bloscReader(await getBuffer(root + field + '/' + chunk, 0));
      for (const t of targets) {
        const loc=locations[t.i];
        // Reuse one nearby wet cell for height, direction and period. Never
        // combine parameters sampled from different cells or providers.
        if(field==='VHM0'&&t.j===0&&(!Number.isFinite(reader.number(t.index))||reader.number(t.index)===array.fill_value)){
          let best=Infinity,selected=null;const ox=loc.x%cx,oy=loc.y%cy,base=t.index-oy*cx-ox;
          for(let yy=Math.max(0,oy-6);yy<=Math.min(cy-1,oy+6);yy++)for(let xx=Math.max(0,ox-6);xx<=Math.min(cx-1,ox+6);xx++){
            const value=reader.number(base+yy*cx+xx),dist=(yy-oy)**2+(xx-ox)**2;
            if(Number.isFinite(value)&&value>=0&&value!==array.fill_value&&dist<best){best=dist;selected={dx:xx-ox,dy:yy-oy};}
          }
          if(selected){loc.dx=selected.dx;loc.dy=selected.dy;records[t.i].latitude=axes.latitude[loc.y+loc.dy];records[t.i].longitude=axes.longitude[loc.x+loc.dx];}
        }
        const v = reader.number(t.index+(loc.dy||0)*cx+(loc.dx||0)); records[t.i].hourly[key][t.j] = Number.isFinite(v) && v !== array.fill_value && v >= 0 && (key !== 'wave_direction' || v <= 360) ? v : null;
      }
    }));
  }
  const updatedAt = dataset.properties.admp_updated_data || dataset.properties.admp_updated;
  return {records, timing:{updatedAt, referenceTime:null, nextUpdate:new Date(Date.parse(updatedAt)+12*3600000).toISOString(),basis:'publication',estimated:true}, attribution:'Copernicus Marine Service, '+PRODUCT+'; FMI; DOI 10.48670/moi-00011'};
}
