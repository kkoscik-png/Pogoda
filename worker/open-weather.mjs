export function normalizeOpenWeather(data,points,model,wave=false){
 const rows=Array.isArray(data)?data:[data];if(rows.length!==points.length)throw Error('Niepełna prognoza Open-Meteo.');
 const fields=wave?['wave_height','wave_direction','wave_period']:['wind_speed_10m','wind_gusts_10m','wind_direction_10m','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','precipitation'];
 return rows.map((row,i)=>{
  if(!Array.isArray(row.hourly?.time))throw Error('Nieprawidłowa prognoza Open-Meteo.');
  const hourly={time:row.hourly.time};for(const field of fields)hourly[field]=hourly.time.map((_,i)=>{const v=row.hourly[field]?.[i];return typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;});
  return {id:points[i].id,latitude:row.latitude,longitude:row.longitude,provider:model.startsWith('ecmwf')?'ECMWF via Open-Meteo':'DWD via Open-Meteo',model,hourly};
 });
}
export function normalizeSnow(data,point){
 if(!Array.isArray(data.timeSeries)||!data.timeSeries.length)throw Error('Brak prognozy SNOW');
 const [longitude,latitude]=data.geometry?.coordinates||[],rows=data.timeSeries.filter(row=>Number.isFinite(Date.parse(row.time))).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 const value=(row,key)=>{const v=row.data?.[key];return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v!==9999?v:null;};
 return {id:point.id,latitude,longitude,provider:'SMHI',model:'SNOW1gv1',referenceTime:data.referenceTime,createdTime:data.createdTime,hourly:{time:rows.map(row=>Date.parse(row.time)/1000),wind_speed_10m:rows.map(row=>value(row,'wind_speed')),wind_gusts_10m:rows.map(row=>value(row,'wind_speed_of_gust')),wind_direction_10m:rows.map(row=>{const v=value(row,'wind_from_direction');return v!==null&&v<=360?v:null;}),...Object.fromEntries(Object.entries({cloud_cover:'cloud_area_fraction',cloud_cover_low:'low_type_cloud_area_fraction',cloud_cover_mid:'medium_type_cloud_area_fraction',cloud_cover_high:'high_type_cloud_area_fraction'}).map(([key,field])=>[key,rows.map(row=>{const v=value(row,field);return v!==null&&v<=8?v*12.5:null;})])),precipitation:rows.map(row=>(Date.parse(row.time)-Date.parse(row.intervalParametersStartTime))===3600000?value(row,'precipitation_amount_mean_deterministic'):null)}};
}
