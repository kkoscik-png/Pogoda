# Baltic — Open-Meteo

Private marine weather dashboard for Ventspils and Nynäshamn / Norvik. Client source is in `client/`. The Sites build embeds it with a server-only API in `dist/server/index.js`; publish that Worker artifact. No weather API key is required. The app has no Windy runtime, iframe, configuration or external API calls.

## Exact query locations

| Point | Latitude | Longitude |
| --- | --- | --- |
| BW Ventspils | 57.407578 | 21.525557 |
| Ventspils Berth | 57.398842 | 21.576607 |
| Norvik Berth | 58.939033 | 17.979752 |

Coordinates were read from the redirects of the three Google Maps links supplied by the owner. Each point retains its source link in the UI.

## Data and spatial precision

- Wind at 10 m, gusts and direction: Open-Meteo Forecast API, with separate requests for `ecmwf_ifs`, `icon_eu` and `icon_global`. Each request contains all three exact coordinates and `cell_selection=nearest`.
- Significant wave height, direction and period: Open-Meteo Marine API, model `ecmwf_wam`, requesting the same three coordinates with `cell_selection=sea`.
- Models are stored independently. Their returned grid coordinates and the distance from the requested location are shown under the forecast heading. Close query points can share a model grid cell and forecast. This does not imply berth-scale forecast accuracy.
- Marine grid cells represent model sea conditions, not shelter inside a port basin. Their coordinates and distances are shown separately from atmospheric grids.
- Point charts use direct point requests. The regional map uses its own sparse sample grid, with spatial interpolation; only waves use a simplified land mask; the map does not provide the point-chart values.
- All records join by Unix timestamps; display timezone is Europe/Stockholm, with daylight saving handled by Intl.
- Cache namespace v3 prevents reuse of the previous two-point data. Freshness is 30 minutes; failed network requests may use a visibly labeled copy up to six hours old. Null/unsupported records remain missing. There is no silent model substitution.

## Controls and checks

Three point cards with source coordinates; four wind source tabs; wind, gust and wave map layers; shared hourly timeline and playback; zoom/focus; particles; 24/48/72-hour charts and tables; model comparison; refresh and source information.

Run `node --check dist/app.js` and `node checks/verify.mjs`. The latter checks exact coordinates, model separation, hourly joins, null/zero handling, charts/tables, metadata, vectors and interpolation. The actual APIs were also requested for the three points and all three atmospheric models plus ECMWF WAM. Browser visual QA was unavailable in the authoring environment.

## Credits

Open-Meteo (CC BY 4.0 and source-model terms), ECMWF, DWD, Leaflet 1.9.4 (BSD-2-Clause), OpenStreetMap contributors and Natural Earth (public domain). Free Open-Meteo endpoints are rate-limited and intended for noncommercial use. Fonts and basemap tiles are external; the app logic, styles, Leaflet runtime and land geometry are included.

## Model flags and hourly comparison

Each exact point carries four vector source flags, with the model name and a mean wind–gust pair in m/s. Flag bearings follow each model's wind-from direction independently, with lateral label lanes for readability. The shared hourly selector, chart/table clicks, keyboard navigation and playback update all point markers. Missing speed/direction omits the affected flag; calm conditions use a circle. The map has a flag visibility toggle. The flags and point labels retain the wind/gust readout when the map color layer is gusts or waves.

The bottom comparison table follows the owner-provided reference: Swedish date bands, hourly columns, separate ICON-EU / ICON / ECMWF / SMHI rows, independently wind/gust-colored cells, mean wind above gusts, flow-direction arrows, a selected-column marker and an ECMWF WAM height/period row. A model name selects the source for the main graph and map. Graphs and all table rows share one horizontal scroll area.

`node checks/flags-table.mjs` verifies flag direction/value updates, all point markers through the actual shared hourly selector, missing/calm data, toggle behavior, all model rows, selected columns and Swedish midnight date grouping. A generated SVG from real API records was rendered and visually inspected for flag readability. Full HTML/browser visual QA remains unavailable.

## Keyless basemap fix

CARTO's old public raster endpoints returned HTTP 200 PNGs containing an “API KEY REQUIRED” notice, so image load/error events did not detect the failure. The map now uses the standard `https://tile.openstreetmap.org/{z}/{x}/{y}.png` source, with visible attribution, browser caching and a valid referrer. There is no prefetching or tile proxy. The basemap now keeps its original light road-map style; wind/wave fields and animation remain separate Canvas layers driven by Open-Meteo. The OSM tile response was fetched and visually verified as a real Baltic basemap. Asset URL versions changed so existing sessions fetch the corrected application code and styles after reload.

## Wind/gust labels and shared scale

Point labels now show the place name, mean wind and gusts on separate lines, with no extra flag caption. Wind and gust numbers are colored independently by their respective values. Flags display `wind – gust` with separately colored numeric segments. The table colors each wind/gust band independently.

The shared palette uses Windy's public `windDetail` defaults, with m/s breakpoints 0 / 3 / 4 / 6 / 10 / 19 / 100 and RGB colors (243,243,243), (243,243,243), (0,200,254), (0,230,0), (254,174,0), (254,0,150), (151,50,222). Values interpolate linearly. The breakpoints were verified from the public Windy Map Forecast bootstrap; they are plain local configuration, with no Windy network dependency. Wind and gust map fields and their legend use the same palette; wave colors are unchanged.

`node checks/gust-labels.mjs` covers palette anchors, independent wind/gust colors, point labels, flag pairs, hourly updates, missing gust data and map/table consistency. Updated flags were rendered from real forecast records and visually inspected.

## Light road map and inland wind coverage

The basemap uses the original light OpenStreetMap raster style, without inversion or hue filters. The wind/gust overlay is more transparent and particles use a darker stroke to keep street names, port roads and animation visible. Maximum map zoom is 16; point focus starts at zoom 12.

The prior diagonal missing segment near Ventspils came from applying a very coarse land polygon to atmospheric fields. Wind and gust coverage now includes land as well as sea inside the Baltic region; the wave field alone retains the land mask. City sampling and Canvas tests confirm all Ventspils neighborhoods receive wind/gust color and particle coverage.

Wind sampling now has 41 points: 23 regional sea samples plus 18 local samples on 3×3 grids around Ventspils and Norvik, including inland positions. Waves continue using the separate 23-point sea grid. The new atmospheric-grid cache suffix prevents reuse of the prior sea-only sample response. This adds local support for interpolation, without changing any model's native resolution. Port chart requests and coordinates are unchanged.

`node checks/coverage.mjs` checks the city boundary, all exact point locations, inland rendered pixels and particle fields, no land erasure for wind/gusts, and correct sea-only wave rendering. All three atmospheric APIs were checked against the expanded 41-point request. Full browser visual QA remains unavailable.

## Numeric route-wave samples

The map shows direct hourly ECMWF WAM significant-wave-height (Hs) values along an indicative great-circle axis from BW Ventspils to Norvik Berth. The four query rows lie at -30, -15, 0 and +15 nautical miles from the axis, where the negative side is southwest toward Gotland. The fourth row is 15 NM beyond the previous southernmost row. Nine interior cross-sections produce 36 corner positions; 24 additional queries sit halfway along and across their cells. One candidate falls on Gotland and is omitted by the land mask, leaving 59 sea query positions. Cell-centre forecasts are direct marine requests, not averages of neighbouring forecasts.

Only the numeric value is drawn at each position, with a transparent background and no border, box, unit suffix, route lines or corridor fill. The shared legend identifies Hs in metres. The map fit control uses the expanded region without rendering its geometry. The returned model-cell coordinates remain in each label title; the model retains its native grid resolution.

The numeric overlay is initially on for wind, gust and wave layers alike. The shared hour selector, table clicks, keyboard and playback update the values and the sampled min–max readout. A toggle hides the numbers. Label collisions are suppressed at smaller zooms and recomputed on pan/zoom/resize without further API requests. Missing values show a dash, calm zero remains 0.0, and cached stale records remain labeled. Refresh includes this request, with the existing 30-minute cache / six-hour failure fallback; the new cache key prevents reusing the smaller 27-point response.

`node checks/route-waves.mjs` verifies geometry, the extra row's 15 NM spacing toward Gotland, cell-centre positions, both axis endpoints, hourly values, zero/null/stale cases, colour-layer independence, label spacing, and a numeric layer with no polylines or polygons. Full browser visual QA remains unavailable in this environment.

## SMHI SNOW wind provider and wave source control

Wind speed, gust and direction now include SMHI SNOW1gv1 as a fourth source. The app requests only the three selected locations from the documented endpoint `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json`. The official SNOW schema uses `timeSeries[].time` and `timeSeries[].data.wind_speed`, `wind_speed_of_gust`, `wind_from_direction`; geometry coordinates retain the returned model cell. Wind and gust units are m/s, directions are wind-from degrees. The 9999 missing sentinel becomes null. Native timestamps are retained without temporal interpolation or extrapolation; later sparse hours and the current hour can therefore show dashes. SMHI never changes the common Open-Meteo hourly axis.

SMHI works on all three point cards, graph/comparison, the fourth table row and fourth vector flag. The selected source is shown in the map stamp and metadata. No bulk SMHI point download is used for the regional wind field; choosing SMHI displays point data and an explicit map status, with no coloured wind field from another provider. Wave forecasts and the 59 route-wave numbers remain ECMWF WAM.

A separate wave-source select is present. ECMWF WAM is available; SMHI SWAN is visibly unavailable and disabled pending a verified documented wave-forecast source. No buoy observations are relabeled as forecast data and no WAM values are relabeled as SMHI. The promised user link has not been supplied; SMHI SWAN forecast integration remains incomplete. The public meteorological SNOW API has no wave parameters.

SMHI open-data attribution is shown (CC BY 4.0); normalization to a common schema is disclosed. References: https://opendata.smhi.se/metfcst/snow1gv1/ and https://www.smhi.se/data/om-smhis-data/villkor-for-anvandning. `node checks/smhi.mjs` covers normalization, missing values, time gaps, point dispatcher isolation, wind/wave independence, four-source UI and blocking an unavailable wave selection.

## Stormglass wave forecasts (server adapter)

The Site is now a Worker with the existing six client assets embedded by `node scripts/build-worker.mjs`. The private Site identity and audience are preserved. Frontend source moved from `dist/` to `client/`; the external Cloudflare checkout still distributes its static frontend in `weather/dist/`. No API credential is in source, the frontend bundle, or hosting manifest.

`STORMGLASS_API_KEY` is a secret runtime variable. The selected `Stormglass AI` source requests `waveHeight`, `waveDirection` and `wavePeriod` from the documented `/v2/weather/point` endpoint with `source=sg`, mapping only that exact source to the app's hourly record. The browser calls same-origin `/api/stormglass/status` and `/api/stormglass/waves?group=ports`; the secret is added only by the server's Authorization header. Fixed coordinate groups prevent an arbitrary-location proxy. Server cache lasts six hours, concurrent duplicate requests are coalesced, missing parameters remain null, upstream errors are sanitized and quotas remain errors. No automatic substitution with WAM or another source occurs.

Default scope is the three port query positions. The 59-point Stormglass route is off unless `STORMGLASS_ROUTE_ENABLED=true` is explicitly configured; it is paginated in batches of five to stay within Worker subrequest limits. When Stormglass is selected without route support, its point forecast appears in cards, chart and table; its route numbers and coloured wave field are absent with an explicit scope note. Selecting ECMWF restores the existing 59-point route and wave field. This avoids presenting WAM as Stormglass or consuming 59 requests on a key with a ten-request daily quota.

The supplied key was verified with one live 73-hour request at 58.2°N, 19.7°E. It reports dailyQuota=10 and requestCount=1. Returned data include waves, wind, gusts, swell, wind waves, current, sea level, ice, water/air temperature and pressure. The actual response has no SMHI source. Stormglass AI is a blend whose component models can differ by parameter. References: https://docs.stormglass.io/#/authentication and https://docs.stormglass.io/#/weather.

`node --test checks/stormglass-api.mjs` covers credentials staying server-side, fixed-location access, six-hour cache, zero/null values, quota errors, explicit route gating, five-point pagination and frontend wave-source isolation. The external Worker for weather.seasync.co allows anonymous access, as selected by the owner; the Stormglass secret stays server-side. The separate Sites preview retains its existing audience settings. Browser visual QA remains unavailable.

## Stormglass map readouts

Selecting Stormglass adds the selected hour's significant wave height and propagation arrow to all three port map labels, including when the map displays wind. These readouts work without the 59-point route option. Zero height is preserved; missing hours, loading, failed requests and quota exhaustion are explicit. The regional Stormglass field still requires an explicitly enabled route and adequate provider quota; no WAM values are substituted. Regression checks cover all three labels, hourly values/directions, missing data and source switching.
