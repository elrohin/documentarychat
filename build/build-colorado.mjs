/* Builds colorado/index.html from build/colorado-source.txt.
 * Runs on a GitHub runner, which can reach Mapbox directly. Coordinates are
 * cached in build/colorado-coords.json and committed, so later runs make no calls.
 * Reuses build/template.html so both city pages stay visually identical. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const cfg = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const TOKEN = process.env.MAPBOX_TOKEN || cfg.mapboxToken;

/* name|neighborhood|area|type|bucket|price|notes  (area = town: Manitou Springs, Colorado Springs, Pueblo, Denver, Aurora ...) */
const places = readFileSync(join(HERE, "colorado-source.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => {
    const [name, neighborhood, borough, type, bucket, price, notes] = l.split("|");
    const o = { name, neighborhood, borough, type, bucket };
    if (price) o.price = price;
    if (notes) o.notes = notes;
    return o;
  });

if (places.length < 60) {
  console.error(`Only parsed ${places.length} places - refusing to rebuild.`);
  process.exit(1);
}

const cachePath = join(HERE, "colorado-coords.json");
const coords = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const CO_BBOX = [-105.70, 37.90, -104.00, 40.15];   // Front Range: Pueblo to north Denver
const CO_CENTRE = [-104.87, 38.86];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BORO = {
  "Manitou Springs": [-104.9172, 38.8597], "Colorado Springs": [-104.8214, 38.8339],
  Fountain: [-104.7003, 38.6822], "Ute Pass": [-105.02, 38.94], "Cripple Creek": [-105.1786, 38.7466],
  Calhan: [-104.30, 39.03], Pueblo: [-104.6091, 38.2544], Rye: [-105.09, 38.06],
  "Cañon City": [-105.2424, 38.4410], Monument: [-104.87, 39.09],
  Denver: [-104.9903, 39.7392], Aurora: [-104.8319, 39.7294], Englewood: [-104.88, 39.65],
  Morrison: [-105.19, 39.65],
};

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function toks(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !["the","and","cafe","bar","restaurant","colorado","springs","shop","food","park","museum"].includes(w));
}
function nameMatches(want, got) {
  const a = norm(want), b = norm(got);
  if (!b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const tw = toks(want), tg = toks(got);
  if (!tw.length) return false;
  return tw.filter((w) => tg.some((g) => g.includes(w) || w.includes(g))).length / tw.length >= 0.5;
}
function km(a, b) {
  const R = 6371, d = Math.PI / 180;
  const dLa = (b[1] - a[1]) * d, dLo = (b[0] - a[0]) * d;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * d) * Math.cos(b[1] * d) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function poi(q, prox, bbox) {
  const u = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  u.searchParams.set("q", q);
  u.searchParams.set("proximity", prox.join(","));
  u.searchParams.set("bbox", (bbox || CO_BBOX).join(","));
  u.searchParams.set("limit", "5");
  u.searchParams.set("access_token", TOKEN);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u);
    if (r.status === 429) { await sleep(1500); continue; }
    if (!r.ok) return [];
    const j = await r.json();
    return (j.features || [])
      .filter((f) => f.properties.feature_type === "poi")
      .map((f) => ({
        name: f.properties.name,
        address: (f.properties.full_address || "").replace(", United States", "")
          .replace(/, Colorado \d{5}(-\d+)?$/, ", CO"),
        coords: f.geometry.coordinates,
      }));
  }
  return [];
}

async function geocodeAddress(a) {
  const u = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  u.searchParams.set("q", a);
  u.searchParams.set("country", "us");
  u.searchParams.set("limit", "1");
  u.searchParams.set("access_token", TOKEN);
  const r = await fetch(u);
  if (!r.ok) return null;
  const j = await r.json();
  return j.features?.[0]?.geometry?.coordinates || null;
}

const hoodCache = new Map();
async function hoodCentre(hood, boro) {
  const key = `${hood}|${boro}`;
  if (hoodCache.has(key)) return hoodCache.get(key);
  const q = hood === boro ? `${boro}, Colorado` : `${hood}, ${boro}, Colorado`;
  let c = null;
  try { c = await geocodeAddress(q); } catch {}
  if (!c || km(c, BORO[boro] || CO_CENTRE) > 30) c = BORO[boro] || CO_CENTRE;
  hoodCache.set(key, c);
  await sleep(200);
  return c;
}

const missing = places.filter((p) => !coords[p.name]);
console.log(`${places.length} places, ${missing.length} need coordinates.`);

const unpinned = [];
for (const p of missing) {
  const centre = await hoodCentre(p.neighborhood, p.borough);
  const tolerance = ["Denver","Aurora","Colorado Springs","Ute Pass","Cripple Creek","Pueblo"].includes(p.borough) ? 18 : 10;
  const tight = [centre[0] - 0.09, centre[1] - 0.07, centre[0] + 0.09, centre[1] + 0.07];
  const attempts = [
    [p.name, CO_BBOX],
    [`${p.name} ${p.neighborhood}`, CO_BBOX],
    [p.name, tight],
    [`${p.name} ${p.borough} CO`, CO_BBOX],
  ];
  let hit = null;
  for (const [q, bbox] of attempts) {
    const list = await poi(q, centre, bbox);
    await sleep(280);
    hit = list.find((h) => nameMatches(p.name, h.name) && km(h.coords, centre) <= tolerance);
    if (hit) break;
  }
  if (!hit) {
    const loose = await poi(p.name, centre, tight);
    await sleep(280);
    hit = loose.find((h) => nameMatches(p.name, h.name));
  }
  if (hit) {
    coords[p.name] = [+hit.coords[0].toFixed(5), +hit.coords[1].toFixed(5), hit.address || ""];
    console.log(`  ok   ${p.name}`);
  } else {
    unpinned.push(`${p.name} (${p.neighborhood}, ${p.borough})`);
    console.log(`  MISS ${p.name} (${p.neighborhood})`);
  }
}

const out = [];
for (const p of places) {
  const c = coords[p.name];
  if (!c) continue;
  const [lon, lat, address] = c;
  if (lon < CO_BBOX[0] || lon > CO_BBOX[2] || lat < CO_BBOX[1] || lat > CO_BBOX[3]) {
    console.log(`  DROP ${p.name} - outside Colorado box`);
    continue;
  }
  const o = { name: p.name, neighborhood: `${p.neighborhood}, ${p.borough}`,
              type: p.type, bucket: p.bucket, lon, lat };
  if (p.price) o.price = p.price;
  if (p.notes) o.notes = p.notes;
  if (address) o.address = address;
  out.push(o);
}

const seen = new Map();
for (const o of out) {
  const k = `${o.lon},${o.lat}`;
  if (seen.has(k)) { o.lon += 0.0003; o.lat += 0.0003; } else seen.set(k, o);
}

let html = readFileSync(join(HERE, "template.html"), "utf8");
if ((html.match(/__DATA__/g) || []).length !== 1) {
  console.error("template.html must contain __DATA__ exactly once."); process.exit(1);
}
const BRAND_CO = String.fromCharCode(60) + 'div class="brand"' + String.fromCharCode(62) + '<b>Colorado</b><span><a href="/">Seattle</a> &middot; <a href="/nyc/">New York</a></span></div>';
html = html
  .replace("<title>Seattle \u2014 a personal list</title>", "<title>Colorado \u2014 a personal list</title>")
  .replace('content="A hand-kept list of places in Seattle. Personal notes only, no reviews."',
           'content="A hand-kept list of places from Pikes Peak to Denver. Personal notes only, no reviews."')
  .replace('<div class="brand"><b>Seattle</b><span>rohin\'s list</span></div>', BRAND_CO)
  .replace("var HOME = { center: [-122.335, 47.625], zoom: 10.6 };",
           "var HOME = { center: [-104.86, 38.85], zoom: 10.3 };")
  .replace('subEl.textContent = bits.length ? bits.join(" ") : "across Seattle and around";',
           'subEl.textContent = bits.length ? bits.join(" ") : "pikes peak to denver";')
  .replace('<div class="sub" id="sub">across Seattle and around</div>',
           '<div class="sub" id="sub">pikes peak to denver</div>')
  .replace("__DATA__", JSON.stringify(out));

if (html.includes("__DATA__") || !html.includes("</html>")) {
  console.error("Built Colorado page failed its sanity check."); process.exit(1);
}

mkdirSync(join(ROOT, "colorado"), { recursive: true });
writeFileSync(join(ROOT, "colorado", "index.html"), html);

/* add a Colorado link to the other two pages (they are regenerated each run, so this runs last) */
function addLink(path, from, to) {
  if (!existsSync(path)) return;
  const t = readFileSync(path, "utf8");
  if (t.includes(from) && !t.includes(to)) { writeFileSync(path, t.replace(from, to)); console.log(`Linked Colorado from ${path}`); }
}
addLink(join(ROOT, "index.html"),
  '<span><a href="/nyc/">New York &rarr;</a></span>',
  '<span><a href="/nyc/">New York</a> &middot; <a href="/colorado/">Colorado</a></span>');
addLink(join(ROOT, "nyc", "index.html"),
  '<span><a href="/">&larr; Seattle</a></span>',
  '<span><a href="/">Seattle</a> &middot; <a href="/colorado/">Colorado</a></span>');

writeFileSync(cachePath, JSON.stringify(coords, null, 0));
writeFileSync(join(HERE, "colorado-unpinned.txt"),
  unpinned.length
    ? "Could not be located automatically:\n\n" + unpinned.map((n) => "  - " + n).join("\n") + "\n"
    : "Everything in the Colorado list is on the map.\n");

console.log(`\nBuilt colorado/index.html with ${out.length} places.`);
if (unpinned.length) console.log(`  no pin: ${unpinned.length}`);
