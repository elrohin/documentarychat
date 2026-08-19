/*
 * Rebuilds index.html from the published Google Sheet.
 *
 * Run by .github/workflows/update-map.yml. Needs no npm packages — Node 20's
 * built-in fetch does everything.
 *
 * Coordinates for places we've already seen live in build/coords.json and are
 * reused, so a normal run makes zero geocoding calls. Only genuinely new places
 * are looked up, and every new pin is sanity-checked against its neighborhood
 * before it's accepted.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const cfg = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const CSV_URL = process.env.SHEET_CSV_URL || cfg.sheetCsvUrl;
const TOKEN = process.env.MAPBOX_TOKEN || cfg.mapboxToken;

if (!CSV_URL || CSV_URL.includes("PASTE_YOUR")) {
  console.error(
    "\n  Nothing to do yet: build/config.json still has the placeholder CSV URL.\n" +
    "  Publish the sheet (File > Share > Publish to web > CSV) and paste the URL in.\n"
  );
  process.exit(1);
}

/* ---------------------------------------------------------------- csv ----- */

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------------ buckets ----- */

const BUCKETS = {
  Drink: new Set(["cocktail bar", "cocktails", "dive bar", "soccer bar", "sports bar", "bar",
    "brewery", "sake bar", "sake brewery", "winery", "irish pub", "plaza", "pub", "wine bar",
    "beer", "taproom"]),
  "Coffee & Sweets": new Set(["coffee", "pastries", "pastry", "bakery", "bakeries", "donuts",
    "doughnuts", "chocolate", "bubble tea", "tea", "ice cream", "dessert", "desserts", "cafe"]),
  "Music & Film": new Set(["music venue", "movie theater", "movie rental", "record store",
    "cinema", "theater", "theatre", "venue"]),
  Shopping: new Set(["clothing", "vintage", "furniture", "glasses store", "bookstore",
    "art gallery", "gallery", "books", "shop", "store", "eyewear"]),
  Groceries: new Set(["grocery store", "grocery", "market", "butcher", "supermarket"]),
  Activities: new Set(["roller rink", "bowling", "arcade", "park", "climbing", "museum",
    "activity", "rink"]),
};

function bucketFor(type) {
  const t = String(type || "").trim().toLowerCase();
  if (!t) return "Eat";
  for (const [bucket, set] of Object.entries(BUCKETS)) if (set.has(t)) return bucket;
  // partial match, so "Korean BBQ" or "Natural Wine Bar" still land sensibly
  for (const [bucket, set] of Object.entries(BUCKETS)) {
    for (const k of set) if (k.length > 3 && t.includes(k)) return bucket;
  }
  return "Eat"; // the sheet is overwhelmingly food; it's the safe default
}

/* ---------------------------------------------------------- geocoding ----- */

const SUBURBS = new Set(["lynnwood", "federal way", "tacoma", "woodinville", "marysville",
  "bothell", "burien", "issaquah", "kirkland", "bellevue", "renton", "tukwila", "redmond",
  "mercer island", "crossroads", "factoria", "edmonds", "mountlake terrace", "lakewood"]);

const CITY_FOR = {
  bellevue: "Bellevue", crossroads: "Bellevue", factoria: "Bellevue", bothell: "Bothell",
  burien: "Burien", "federal way": "Federal Way", issaquah: "Issaquah", kirkland: "Kirkland",
  lynnwood: "Lynnwood", marysville: "Marysville", "mercer island": "Mercer Island",
  renton: "Renton", tacoma: "Tacoma", tukwila: "Tukwila", woodinville: "Woodinville",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function toks(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !["the", "and", "cafe", "bar", "restaurant", "seattle", "pub"].includes(w));
}
function nameMatches(want, got) {
  const a = norm(want), b = norm(got);
  if (!b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const tw = toks(want), tg = toks(got);
  if (!tw.length) return false;
  const hit = tw.filter((w) => tg.some((g) => g.includes(w) || w.includes(g))).length;
  return hit / tw.length >= 0.5;
}
function km(a, b) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * d2r, dLon = (b[0] - a[0]) * d2r;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * d2r) * Math.cos(b[1] * d2r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function poiSearch(q, prox, bbox) {
  const u = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  u.searchParams.set("q", q);
  u.searchParams.set("proximity", prox.join(","));
  if (bbox) u.searchParams.set("bbox", bbox.join(","));
  u.searchParams.set("limit", "5");
  u.searchParams.set("access_token", TOKEN);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u);
    if (res.status === 429) { await sleep(1500); continue; }
    if (!res.ok) return [];
    const j = await res.json();
    return (j.features || [])
      .filter((f) => f.properties.feature_type === "poi")
      .map((f) => ({
        name: f.properties.name,
        address: (f.properties.full_address || "").replace(", United States", "")
          .replace(/, Washington \d{5}(-\d+)?$/, ", WA"),
        coords: f.geometry.coordinates,
      }));
  }
  return [];
}

async function geocodeAddress(addr) {
  const u = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  u.searchParams.set("q", addr);
  u.searchParams.set("country", "us");
  u.searchParams.set("limit", "1");
  u.searchParams.set("access_token", TOKEN);
  const res = await fetch(u);
  if (!res.ok) return null;
  const j = await res.json();
  return j.features?.[0]?.geometry?.coordinates || null;
}

const hoodCache = new Map();
async function hoodCentre(hood, city) {
  const key = `${hood}|${city}`;
  if (hoodCache.has(key)) return hoodCache.get(key);
  const c = await geocodeAddress(`${hood}, ${city}, WA`);
  hoodCache.set(key, c);
  await sleep(200);
  return c;
}

async function geocodeNew(place) {
  const hood = place.neighborhood || "Seattle";
  const city = CITY_FOR[hood.toLowerCase()] || "Seattle";
  const centre = (await hoodCentre(hood, city)) || [-122.33, 47.61];
  const tolerance = SUBURBS.has(hood.toLowerCase()) ? 6 : 3.5;
  const tight = [centre[0] - 0.045, centre[1] - 0.032, centre[0] + 0.045, centre[1] + 0.032];
  const wide = [-122.75, 47.0, -121.85, 48.25];

  // bare name first — appending the neighborhood makes Mapbox return the
  // neighborhood centroid instead of the business
  const attempts = [
    [place.name, wide],
    [`${place.name} ${city}`, wide],
    [place.name, tight],
    [`${place.name} ${hood} ${city}`, tight],
  ];

  for (const [q, bbox] of attempts) {
    const hits = await poiSearch(q, centre, bbox);
    await sleep(300);
    const good = hits.find((h) => nameMatches(place.name, h.name) && km(h.coords, centre) <= tolerance);
    if (good) return good;
  }

  // last resort: any POI in the tight box whose name matches, regardless of distance
  const loose = await poiSearch(place.name, centre, tight);
  const any = loose.find((h) => nameMatches(place.name, h.name));
  return any || null;
}

/* --------------------------------------------------------------- main ----- */

const res = await fetch(CSV_URL, { redirect: "follow" });
if (!res.ok) {
  console.error(`Could not read the sheet (HTTP ${res.status}). Is it still published to the web?`);
  process.exit(1);
}
const rows = parseCsv(await res.text());

const closed = new Set(cfg.closed || []);
const multi = new Set(cfg.multiLocation || []);
const HEADERISH = new Set(["name", "w", "place", "places", ""]);

const places = [];
const seen = new Set();
for (const r of rows) {
  const name = (r[0] || "").trim();
  const neighborhood = (r[1] || "").trim();
  const type = (r[2] || "").trim();
  const price = (r[3] || "").trim();
  const notes = (r[4] || "").trim();
  if (!name || HEADERISH.has(name.toLowerCase())) continue;
  if (!neighborhood) continue;              // wishlist / stray cells
  if (closed.has(name)) continue;
  if (seen.has(name)) continue;             // duplicate row
  seen.add(name);
  places.push({ name, neighborhood, type, price, notes });
}

if (places.length < 20) {
  console.error(`Only parsed ${places.length} places — that looks wrong, refusing to rebuild.`);
  process.exit(1);
}

const coords = JSON.parse(readFileSync(join(HERE, "coords.json"), "utf8"));
const before = Object.keys(coords).length;

const added = places.filter((p) => !coords[p.name]);
const removed = Object.keys(coords).filter((n) => !seen.has(n));
const unpinned = [];

if (added.length) console.log(`Geocoding ${added.length} new place(s)…`);
for (const p of added) {
  try {
    const hit = await geocodeNew(p);
    if (hit) {
      coords[p.name] = [
        +hit.coords[0].toFixed(5), +hit.coords[1].toFixed(5), hit.address || "",
      ];
      console.log(`  ok   ${p.name} -> ${hit.address || hit.coords.join(", ")}`);
    } else {
      unpinned.push(p.name);
      console.log(`  MISS ${p.name} (${p.neighborhood}) — left off the map for now`);
    }
  } catch (e) {
    unpinned.push(p.name);
    console.log(`  ERR  ${p.name}: ${e.message}`);
  }
}

for (const n of removed) delete coords[n];

const R = cfg.region;
const out = [];
for (const p of places) {
  const c = coords[p.name];
  if (!c) continue;
  const [lon, lat, address] = c;
  if (lon < R.west || lon > R.east || lat < R.south || lat > R.north) {
    console.log(`  DROP ${p.name} — coordinates outside the region`);
    continue;
  }
  const o = {
    name: p.name,
    neighborhood: p.neighborhood,
    type: p.type,
    bucket: bucketFor(p.type),
    lon, lat,
  };
  if (p.price) o.price = p.price;
  if (p.notes) o.notes = p.notes;
  if (address) o.address = address;
  if (multi.has(p.name)) o.multi = true;
  out.push(o);
}

// keep pins that share an exact location from hiding each other
const bySpot = new Map();
for (const o of out) {
  const k = `${o.lon},${o.lat}`;
  if (bySpot.has(k)) { o.lon += 0.00035; o.lat += 0.00035; }
  else bySpot.set(k, o);
}

const template = readFileSync(join(HERE, "template.html"), "utf8");
if ((template.match(/__DATA__/g) || []).length !== 1) {
  console.error("build/template.html must contain __DATA__ exactly once.");
  process.exit(1);
}
const html = template.replace("__DATA__", JSON.stringify(out));

// sanity checks before anything is written
if (!html.includes("</html>") || html.includes("__DATA__")) {
  console.error("Built page failed its sanity check — not writing.");
  process.exit(1);
}
JSON.parse(JSON.stringify(out)); // will throw on anything unserialisable

writeFileSync(join(ROOT, "index.html"), html);
writeFileSync(join(HERE, "coords.json"), JSON.stringify(coords, null, 0));
writeFileSync(
  join(HERE, "unpinned.txt"),
  unpinned.length
    ? "These places are in the sheet but could not be located automatically.\n" +
      "Check the spelling against how the business is actually listed, or add\n" +
      "the coordinates by hand to build/coords.json as [lon, lat, \"address\"].\n\n" +
      unpinned.map((n) => "  - " + n).join("\n") + "\n"
    : "Everything in the sheet is on the map.\n"
);

console.log(`\nBuilt index.html with ${out.length} places.`);
console.log(`  cache: ${before} -> ${Object.keys(coords).length}`);
if (added.length)    console.log(`  added:   ${added.map((p) => p.name).join(", ")}`);
if (removed.length)  console.log(`  removed: ${removed.join(", ")}`);
if (unpinned.length) console.log(`  no pin:  ${unpinned.join(", ")}`);
