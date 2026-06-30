// Smoke-test the generated map's inline JS without a browser.
// Mocks just enough Leaflet to run the script, and exercises the per-feature
// style / pointToLayer / popup callbacks against the real embedded data so any
// CAT[...] lookup miss (the class of bug that broke the page) throws here.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const app = scripts.find(s => s.includes('const data='));
if (!app) { console.error('FAIL: no inline app script found'); process.exit(1); }

let featuresExercised = 0;
function layer() {
  const o = {
    addTo() { return o; }, addLayer() { return o; },
    bindTooltip() { return o; }, bindPopup() { return o; }, on() { return o; },
    clearLayers() { return o; }, addData() { return o; },
    getBounds() { return { getCenter() { return { lat: 0, lng: 0 }; }, pad() { return this; } }; },
  };
  return o;
}
const L = {
  map() { return { fitBounds() {}, addLayer() {}, on() {}, hasLayer() { return false; },
                   getZoom() { return 14; }, getBounds() { return { pad() { return this; }, contains() { return false; } }; },
                   closePopup() {} }; },
  popup() { const p = { setLatLng() { return p; }, setContent() { return p; }, openOn() { return p; } }; return p; },
  tileLayer() { return layer(); },
  layerGroup() { return layer(); },
  featureGroup() { return layer(); },
  circleMarker() { return layer(); },
  geoJSON(data, opts) {
    if (data && data.features && opts) {
      for (const f of data.features) {
        if (opts.style) opts.style(f);                                   // runs CAT[cat].c
        if (opts.pointToLayer && f.geometry.type === 'Point') opts.pointToLayer(f, [0, 0]);
        if (opts.onEachFeature) opts.onEachFeature(f, layer());          // runs pop() -> CAT[cat].label
        featuresExercised++;
      }
    }
    return layer();
  },
  control(o) { const c = layer(); c.addTo = () => c; return c; },
  DomUtil: { create() { return { style: {}, innerHTML: '' }; } },
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

try {
  new Function('L', app)(L);
  console.log(`OK: script ran clean, exercised ${featuresExercised} features`);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
