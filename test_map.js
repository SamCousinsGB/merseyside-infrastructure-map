// Smoke-test the generated map's inline JS without a browser.
// Mocks just enough Leaflet to run the script, then exercises the per-feature
// style / pointToLayer / popup callbacks against the real committed data so any
// CAT[...] lookup miss (the class of bug that broke the page) throws here.
//
// The page loads its features from data.json and its LV/gas geometry from tile
// trees, so the mock resolves fetch() against real files on disk and pretends
// every layer is switched on at street zoom. That means the tile render paths
// (and their style/popup callbacks) run for real, not just the top-level script.
const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2];
const root = path.dirname(path.resolve(htmlPath));
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const app = scripts.find(s => s.includes('initData') || s.includes('const data='));
if (!app) { console.error('FAIL: no inline app script found'); process.exit(1); }

// Zoom the fake viewport sits at: 17 so LV cables (z16+) and gas services (z17+)
// both render. Override with ZOOM=n to spot-check a different band.
const ZOOM = Number(process.env.ZOOM || 17);

let featuresExercised = 0;
const perLayer = {};        // source -> features drawn, so a silently empty tree shows up

// Attribute a drawn feature to its source by shape rather than by "whichever
// file was parsed most recently" - the tile renders resolve asynchronously and
// interleave with data.json, so anything time-based mislabels them.
function tagOf(f) {
  const p = (f && f.properties) || {};
  if (p.du !== undefined || (p.t !== undefined && p.p !== undefined)) return 'gas';
  if (p.rag !== undefined) return 'lv';
  if (p.cat !== undefined) return 'osm';
  if (p.id !== undefined) return 'gas-ag';   // above-ground sites {id} / pipes {id,len}
  return 'other';
}

const allLayers = [];       // every layer the page builds, so the test can switch them on
let labelsDrawn = 0;        // HV / power-station tooltips mounted
// `register:false` for the per-feature child layers, so the "switch everything
// on" sweep below only walks real layers and not 20k features.
function layer(register = true) {
  const h = {}, kids = [];
  const o = {
    _handlers: h, _children: kids,
    on(ev, fn) { for (const e of String(ev).split(/\s+/)) (h[e] = h[e] || []).push(fn); return o; },
    off() { return o; },
    fire(ev) { for (const fn of (h[ev] || [])) fn(); return o; },
    addTo() { o.fire('add'); return o; },
    remove() { o.fire('remove'); return o; },
    addLayer(l) { if (l) kids.push(l); return o; },
    removeLayer(l) { const i = kids.indexOf(l); if (i >= 0) kids.splice(i, 1); return o; },
    eachLayer(fn) { for (const c of kids.slice()) fn(c); return o; },
    getLayers() { return kids.slice(); },
    bindTooltip() { return o; }, bindPopup() { return o; },
    clearLayers() { kids.length = 0; return o; }, setStyle() { return o; },
    addData(d) { drawAll(d, o._opts, o); return o; },
    getBounds() { return bounds(); },
    getCenter() { return { lat: 53.4, lng: -2.98 }; },
    getLatLng() { return { lat: 53.4, lng: -2.98 }; },
  };
  if (register) allLayers.push(o);
  return o;
}
function bounds() {
  const b = {
    getWest: () => -2.99, getEast: () => -2.97,
    getNorth: () => 53.41, getSouth: () => 53.39,
    getCenter: () => ({ lat: 53.4, lng: -2.98 }),
    pad: () => b, contains: () => true,
  };
  return b;
}
function drawAll(data, opts, parent) {
  if (!data || !data.features || !opts) return;
  for (const f of data.features) {
    // Leaflet accepts `style` as a function OR a plain object; only the function
    // form is worth invoking, and calling the object form would throw
    if (typeof opts.style === 'function') opts.style(f);
    if (opts.pointToLayer && f.geometry && f.geometry.type === 'Point') opts.pointToLayer(f, [0, 0]);
    const child = layer(false);
    child.feature = f;                       // hvLabelDescriptors() reads l.feature
    if (opts.onEachFeature) opts.onEachFeature(f, child);
    if (parent) parent._children.push(child);
    featuresExercised++;
    const t = tagOf(f);
    perLayer[t] = (perLayer[t] || 0) + 1;
  }
}

const fakeMap = {
  fitBounds() {}, addLayer() {}, removeLayer() {}, on() {}, off() {},
  hasLayer() { return true; },              // pretend every toggle is on
  getZoom() { return ZOOM; },
  getBounds() { return bounds(); },
  closePopup() {}, setView() {}, getCenter() { return { lat: 53.4, lng: -2.98 }; },
  createPane() { return el(); },
};

const L = {
  map() { return fakeMap; },
  popup() { const p = { setLatLng() { return p; }, setContent() { return p; }, openOn() { return p; } }; return p; },
  tileLayer() { return layer(); },
  layerGroup() { return layer(); },
  featureGroup() { return layer(); },
  marker() { return layer(); },
  divIcon() { return {}; },
  circleMarker() { return layer(); },
  latLng(lat, lng) { return { lat, lng, distanceTo: () => 0, equals: () => false }; },
  tooltip() {
    const t = { setLatLng() { return t; }, setContent(c) { t._c = c; return t; },
                addTo() { labelsDrawn++; return t; } };
    return t;
  },
  geoJSON(data, opts) { const o = layer(); o._opts = opts; drawAll(data, opts, o); return o; },
  control(o) { const c = layer(); c.addTo = () => { c._map = fakeMap; return c; }; c.remove = () => { c._map = null; return c; }; return c; },
  DomUtil: { create() { return { style: {}, innerHTML: '', classList: { add() {}, remove() {} } }; } },
  DomEvent: { on() {}, stop() {}, disableClickPropagation() {}, disableScrollPropagation() {} },
};
L.control.layers = () => layer();
L.canvas = function () { return layer(); };
L.canvas.tile = function () { return {}; };
L.setOptions = function () {};
L.Control = { extend(proto) {
  function C(...a) { if (proto.initialize) proto.initialize.apply(this, a); }
  C.prototype = Object.assign({}, proto, { addTo() { return this; } });
  return C;
} };

// Minimal DOM so the page's boot/error handling and any control markup can run.
const el = () => ({
  style: {}, innerHTML: '', className: '', dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [],
});
global.document = {
  getElementById: () => el(), createElement: () => el(), body: el(),
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
};
global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Resolve the page's fetch()es against real files next to the html, so data.json,
// extra_infra.geojson and the committed tile trees are exercised as-is. A missing
// file answers {ok:false} exactly as the real page would handle a gap in a tree.
const fetched = {};   // tag -> [hits, misses]; a tree that is never asked for shows up as absent
global.fetch = (url) => {
  const rel = String(url).split('?')[0];
  const file = path.join(root, rel);
  const tag = rel.startsWith('tiles/') ? rel.split('/').slice(0, 3).join('/') : rel;
  const rec = (fetched[tag] = fetched[tag] || [0, 0]);
  if (!fs.existsSync(file)) { rec[1]++; return Promise.resolve({ ok: false, json: () => Promise.resolve({ features: [] }) }); }
  rec[0]++;
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))),
  });
};

// The page catches its own load failures and degrades gracefully, which would
// otherwise let a broken build "pass" here. Treat anything it reports as a fail.
const pageErrors = [];
const realError = console.error.bind(console);
console.error = (...a) => { pageErrors.push(a.map(String).join(' ')); realError(...a); };

(async () => {
  try {
    new Function('L', app)(L);
    // let data.json / extra_infra resolve and the sub-layers get built
    for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 300));
    // Every layer now ships switched OFF, so nothing would fetch a tile on its
    // own. Fire the 'add' handlers the way the layer deck does when a user turns
    // a layer on — that is what drives the LV / gas tile renders.
    for (const o of allLayers.slice()) {
      if (o._handlers && o._handlers.add) o.fire('add');
    }
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
  if (pageErrors.length) {
    realError('FAIL: the page reported ' + pageErrors.length + ' error(s):');
    for (const e of pageErrors) realError('  ' + e);
    process.exit(1);
  }
  if (!featuresExercised) { realError('FAIL: script ran but drew nothing'); process.exit(1); }
  const detail = Object.entries(perLayer).map(([k, v]) => `${k}=${v}`).join(' ');
  const req = Object.entries(fetched).map(([k, [h, m]]) => `${k} ${h}ok/${m}miss`).join(', ');
  console.log(`OK: script ran clean at z${ZOOM}, exercised ${featuresExercised} features (${detail})`);
  // cumulative across rebuilds (each build clears first and is capped), so this
  // is "labels were mounted at all", not a simultaneous count
  console.log(`    hv label mounts: ${labelsDrawn} (cumulative over rebuilds)`);
  console.log(`    fetched: ${req}`);
})();
