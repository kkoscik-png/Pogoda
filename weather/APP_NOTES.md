# Baltic — Open-Meteo

Private, buildless marine weather dashboard for Ventspils and Nynäshamn / Norvik. Serve `dist` as the web root. No weather API key is required. The app has no Windy runtime, iframe, configuration or external API calls.

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

Three point cards with source coordinates; three wind model tabs; wind, gust and wave map layers; shared hourly timeline and playback; zoom/focus; particles; 24/48/72-hour charts and tables; model comparison; refresh and source information.

Run `node --check dist/app.js` and `node checks/verify.mjs`. The latter checks exact coordinates, model separation, hourly joins, null/zero handling, charts/tables, metadata, vectors and interpolation. The actual APIs were also requested for the three points and all three atmospheric models plus ECMWF WAM. Browser visual QA was unavailable in the authoring environment.

## Credits

Open-Meteo (CC BY 4.0 and source-model terms), ECMWF, DWD, Leaflet 1.9.4 (BSD-2-Clause), OpenStreetMap contributors and Natural Earth (public domain). Free Open-Meteo endpoints are rate-limited and intended for noncommercial use. Fonts and basemap tiles are external; the app logic, styles, Leaflet runtime and land geometry are included.

## Model flags and hourly comparison

Each exact point carries three vector model flags, with the model name and a mean wind–gust pair in m/s. Flag bearings follow each model's wind-from direction independently, with lateral label lanes for readability. The shared hourly selector, chart/table clicks, keyboard navigation and playback update all point markers. Missing speed/direction omits the affected flag; calm conditions use a circle. The map has a flag visibility toggle. The flags and point labels retain the wind/gust readout when the map color layer is gusts or waves.

The bottom comparison table follows the owner-provided reference: Swedish date bands, hourly columns, separate ICON-EU / ICON / ECMWF rows, independently wind/gust-colored cells, mean wind above gusts, flow-direction arrows, a selected-column marker and an ECMWF WAM height/period row. A model name selects the source for the main graph and map. Graphs and all table rows share one horizontal scroll area.

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
