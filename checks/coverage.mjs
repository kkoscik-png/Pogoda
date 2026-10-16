import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
let pixels,composites=[],center={lat:57.39,lon:21.64};
const fctx={_mode:'source-over',get globalCompositeOperation(){return this._mode},set globalCompositeOperation(v){this._mode=v;composites.push(v)},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},drawImage(){}};
const sc={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(im){pixels=im.data;}};
const c={console,Intl,Date,Math,Number,Array,Object,String,Map,Set,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),L:{DomUtil:{setPosition(){}}},document:{getElementById:()=>({}),createElement:()=>({getContext:()=>sc})}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,PORTS,grid,fieldCovers,isLand,isSea,drawField,getScreen:()=>screenField,url};',c);
const t=c.t;t.state.land=JSON.parse(fs.readFileSync('dist/assets/land.json'));const wg=t.grid(),mg=t.grid('wave');assert.equal(wg.length,41);assert.equal(mg.length,23);
// Every point across the city area must receive atmospheric coverage, including inland neighborhoods.
for(let lat=57.34;lat<=57.48;lat+=.02)for(let lon=21.51;lon<=21.71;lon+=.02){assert(t.fieldCovers(lon,lat,'wind'));assert(t.fieldCovers(lon,lat,'gust'));}
for(const p of t.PORTS){assert(t.fieldCovers(p.lon,p.lat,'wind'));assert(t.fieldCovers(p.lon,p.lat,'gust'));}
assert(t.isLand(21.64,57.39));assert(!t.fieldCovers(21.64,57.39,'wave'));assert(!t.fieldCovers(40,45,'wind'));
t.state.times=[t.state.base];const series={hourly:{time:t.state.times,wind_speed_10m:[8],wind_gusts_10m:[12],wind_direction_10m:[220],wave_height:[1.5],wave_direction:[200],wave_period:[4]}};
t.state.windGrid.ecmwf_ifs=wg.map(p=>({...p,series}));t.state.waveGrid=mg.map(p=>({...p,series}));
c.testContext=fctx;c.testMap={getSize:()=>({x:48,y:48}),containerPointToLayerPoint:()=>({x:0,y:0}),containerPointToLatLng:p=>({lat:center.lat+(24-p[1])*.0005,lng:center.lon+(p[0]-24)*.0005}),latLngToContainerPoint:p=>({x:24+(p[1]-center.lon)/.0005,y:24-(p[0]-center.lat)/.0005})};
vm.runInContext('map=testMap;fctx=testContext;fieldCanvas={style:{}};particleCanvas={style:{}};',c);
const count=()=>Array.from(pixels).filter((v,i)=>i%4===3&&v>0).length;
for(const layer of ['wind','gust']){composites=[];t.state.layer=layer;t.drawField();assert.equal(count(),16);assert(!composites.includes('destination-out'));assert.equal(t.getScreen().values.filter(Boolean).length,16);}
composites=[];t.state.layer='wave';t.drawField();assert.equal(count(),0);assert(composites.includes('destination-out'));
center={lat:57.5,lon:21.2};t.drawField();assert.equal(count(),16);
const requests=Object.fromEntries(['ecmwf_ifs','icon_eu','icon_global'].map(model=>[model,t.url('https://api.open-meteo.com/v1/forecast',wg,{hourly:'wind_speed_10m,wind_gusts_10m,wind_direction_10m',models:model,wind_speed_unit:'ms',cell_selection:'nearest'})]));fs.writeFileSync('/tmp/baltic-coverage-requests.json',JSON.stringify(requests));
console.log('PASS: 41 wind samples / 23 marine samples, full Ventspils city wind/gust coverage, nonempty city canvas/particle field, no land erasure for wind, and waves excluded on land but rendered at sea.');
