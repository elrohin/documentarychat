/* Builds manitou/index.html — the Oct 9–12 2026 trip page — from build/trip-source.json.
 * Place details (hours, phone, photo, drive time from the house) come from Google Places (New)
 * and the Routes API using the GOOGLE_MAPS_KEY secret, and are cached in build/trip-cache.json
 * so a normal run makes few or no calls. Forecasts come from api.weather.gov (no key).
 * Runs after the map builds and adds a Manitou link to the other pages' headers. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const KEY = process.env.GOOGLE_MAPS_KEY || "";
const src = JSON.parse(readFileSync(join(HERE, "trip-source.json"), "utf8"));
const cachePath = join(HERE, "trip-cache.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { places: {}, weather: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the Colorado map list gives us the canonical place names + your notes ---- */
const coPlaces = readFileSync(join(HERE, "colorado-source.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => { const [name, hood, area, type, bucket, price, notes] = l.split("|"); return { name, hood, area, type, bucket, price, notes }; });
const coCoords = existsSync(join(HERE, "colorado-coords.json")) ? JSON.parse(readFileSync(join(HERE, "colorado-coords.json"), "utf8")) : {};

/* names as they appear in the sheet -> names in the map list */
const ALIAS = {
  "nana's dim sum & dumplings": "Nana Dim Sum", "nana's dim sum": "Nana Dim Sum",
  "cog railway": "Pikes Peak Cog Railway", "penny arcade": "Manitou Springs Penny Arcade",
  "ghost stories of old manitou": "Manitou Springs Heritage Center", "ghost stories walk": "Manitou Springs Heritage Center",
  "taytacha peruvian": "Taytacha Peruvian Cuisine", "shanxi noodles": "Shanxi Noodles & Dumplings House",
  "mausam indian flavors": "Mausam Indian Flavors", "provision bread & bakery": "Provision Bread & Bakery", "provision bread": "Provision Bread & Bakery",
  "chef liu's": "Chef Liu's Kitchen", "nana's": "Nana Dim Sum", "stanley marketplace": "Stanley Marketplace",
  "nile ethiopian": "Nile Ethiopian", "tofu story": "Tofu Story", "swirl": "Swirl Wine Bar", "swirl for a glass": "Swirl Wine Bar",
  "don turi's": "Don Turi's Tacos y Tortas", "pikes peak highway": "Pikes Peak Highway", "tong tong": "Tong Tong",
  "shin sa dong": "Shin Sa Dong", "florissant fossil beds": "Florissant Fossil Beds National Monument",
  "cripple creek heritage center": "Cripple Creek Heritage Center", "mollie kathleen gold mine": "Mollie Kathleen Gold Mine",
  "victor": "Victor Lowell Thomas Museum", "green mountain falls": "Green Box Skyspace", "uchenna": "Uchenna",
  "totem brunch": "Totem Restaurant", "totem": "Totem Restaurant", "makfam": "MAKfam", "denver art museum": "Denver Art Museum",
  "rebel bread": "Rebel Bread", "mondo vino": "Mondo Vino", "museum of colorado prisons": "Museum of Colorado Prisons",
  "royal gorge route railroad lunch train": "Royal Gorge Route Railroad", "royal gorge bridge & park": "Royal Gorge Bridge",
  "ephemera": "Ephemera", "musso farms": "Musso Farms", "milberger farms": "Milberger Farms", "gray's coors tavern": "Gray's Coors Tavern",
  "pueblo riverwalk": "Pueblo Riverwalk", "cactus flower": "Cactus Flower", "gold dust saloon": "Gold Dust Saloon",
  "helen hunt falls": "Helen Hunt Falls", "red rocks park": "Red Rocks Park", "tacos selene": "Tacos Selene", "el taco de mexico": "El Taco de Mexico",
  "union station": "Union Station", "paravicini's": "Paravicini's", "garden of the gods": "Garden of the Gods", "ghost town museum": "Ghost Town Museum",
  "ivywild school": "Ivywild School", "money museum": "ANA Money Museum", "pioneers museum": "Colorado Springs Pioneers Museum",
  "rail yard duckpin bowling": "Rail Yard Gaming + Gastropub", "momo korean": "Momo Korean Restaurant", "miramont castle": "Miramont Castle",
  "manitou thai & ramen": "Manitou Thai & Ramen", "dungeons & javas": "Dungeons and Javas", "iron springs chateau melodrama": "Iron Springs Chateau",
  "denver botanic gardens": "Denver Botanic Gardens York Street", "dân dã": "Dân Dã", "society 303": "Society 303",
  "juicy kebab": "Juicy Kebab", "92 chicken": "92 Chicken", "coaltrain fine wine": "Coaltrain Fine Wine", "shame & regret": "Shame & Regret",
  "paint mines interpretive park": "Paint Mines Interpretive Park", "korean garden": "Korean Garden", "yemen grill": "Yemen Grill",
  "coffee story": "Coffee Story by Barakah Brews", "cafe tres": "Cafe Tres", "adam's mountain cafe": "Adam's Mountain Cafe",
  "rock ledge ranch grounds": "Rock Ledge Ranch", "manitou cliff dwellings": "Manitou Cliff Dwellings", "cave of the winds": "Cave of the Winds",
  "red rock canyon contemplative trail": "Red Rock Canyon Open Space", "new saigon bakery banh mi for the drive": "New Saigon Bakery & Deli",
  "happy time korean": "Happy Time Korean Restaurant", "don guillo": "Don Guillo", "cubaneate": "Cubaneate", "estela's mill stop cafe": "Estela's Mill Stop Cafe",
};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();
const byNorm = new Map(coPlaces.map((p) => [norm(p.name), p]));
function findPlaces(text) {
  const t = norm(text);
  const hits = [];
  for (const [k, v] of Object.entries(ALIAS)) if (t.includes(k) && byNorm.has(norm(v))) hits.push(byNorm.get(norm(v)));
  for (const [k, p] of byNorm) if (k.length > 4 && t.includes(k)) hits.push(p);
  return [...new Set(hits)];
}

/* ---- Google Places (New) + Routes ---- */
async function placeDetails(p) {
  if (cache.places[p.name]?.id) return cache.places[p.name];
  if (!KEY) return null;
  const [lat, lon] = { "Denver": [39.7392, -104.9903], "Aurora": [39.7294, -104.8319], "Englewood": [39.65, -104.88], "Morrison": [39.65, -105.19],
    "Pueblo": [38.2544, -104.6091], "Cañon City": [38.441, -105.2424], "Rye": [38.0616, -105.0945] }[p.area] || [38.8597, -104.9172];
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours.weekdayDescriptions,places.priceLevel,places.photos,places.websiteUri,places.googleMapsUri,places.location" },
    body: JSON.stringify({ textQuery: `${p.name} ${p.hood} ${p.area} Colorado`, locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 40000 } }, maxResultCount: 1 }),
  });
  if (!r.ok) { console.log(`  places ${r.status} ${p.name}`); return null; }
  const g = (await r.json()).places?.[0];
  if (!g) { console.log(`  no place ${p.name}`); return null; }
  const d = { id: g.id, gname: g.displayName?.text, address: (g.formattedAddress || "").replace(", USA", ""), phone: g.nationalPhoneNumber || "",
    hours: g.regularOpeningHours?.weekdayDescriptions || [], price: g.priceLevel || "", web: g.websiteUri || "", maps: g.googleMapsUri || "",
    lat: g.location?.latitude, lon: g.location?.longitude, photo: "" };
  if (g.photos?.[0]?.name) {
    const pr = await fetch(`https://places.googleapis.com/v1/${g.photos[0].name}/media?maxWidthPx=1000&skipHttpRedirect=true&key=${KEY}`);
    if (pr.ok) d.photo = (await pr.json()).photoUri || "";
  }
  try {
    const rr = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" },
      body: JSON.stringify({ origin: { address: src.home }, destination: { placeId: g.id }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
    });
    if (rr.ok) { const rt = (await rr.json()).routes?.[0]; if (rt) { d.driveMin = Math.round(parseInt(rt.duration) / 60); d.miles = Math.round(rt.distanceMeters / 1609); } }
  } catch {}
  cache.places[p.name] = d;
  await sleep(120);
  console.log(`  ok   ${p.name}`);
  return d;
}

/* ---- NWS ---- */
async function forecast(label, lat, lon) {
  try {
    const h = { "User-Agent": "documentarychat.org trip page (elangovan.rohin@gmail.com)", Accept: "application/geo+json" };
    const pt = await (await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers: h })).json();
    const fc = await (await fetch(pt.properties.forecast, { headers: h })).json();
    const periods = (fc.properties.periods || []).filter((p) => p.startTime >= "2026-10-09" && p.startTime < "2026-10-14")
      .map((p) => ({ name: p.name, t: p.temperature, unit: p.temperatureUnit, short: p.shortForecast, wind: p.windSpeed, day: p.isDaytime }));
    cache.weather[label] = { fetched: new Date().toISOString().slice(0, 10), periods };
  } catch (e) { console.log(`  weather ${label}: ${e.message}`); }
}

/* ---- collect ---- */
const used = new Map();
for (const tab of src.tabs) for (const row of tab.rows) {
  for (const p of findPlaces(`${row[1] || ""} ${row[2] || ""}`)) used.set(p.name, p);
}
console.log(`${used.size} places referenced by the plans`);
for (const p of used.values()) await placeDetails(p);
await forecast("Manitou Springs", 38.8597, -104.9172);
await forecast("Pikes Peak summit", 38.8409, -105.0423);
writeFileSync(cachePath, JSON.stringify(cache, null, 0));

/* ---- html ---- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const placeData = {};
for (const p of used.values()) {
  const d = cache.places[p.name] || {};
  const c = coCoords[p.name];
  placeData[p.name] = { name: p.name, type: p.type, hood: `${p.hood}, ${p.area}`, note: p.notes || "", price: p.price || "",
    address: d.address || c?.[2] || "", phone: d.phone || "", hours: d.hours || [], photo: d.photo || "", web: d.web || "", maps: d.maps || "",
    drive: d.driveMin ? `${d.driveMin} min · ${d.miles} mi from the house` : "" };
}
function rowHtml(row) {
  const [a, b, c] = row;
  if (!a && !b && !c) return `<div class="gap"></div>`;
  if (/^October \d+/.test(a || "")) return `<h2 class="day"><span>${esc(a)}</span><small>${esc(b || "")}</small></h2>`;
  if (/^Stay /.test(a || "")) return `<div class="row stay"><div class="t"></div><div class="i">${esc(a)}${b ? ` <span class="n">${esc(b)}</span>` : ""}</div></div>`;
  const places = findPlaces(`${b || ""} ${c || ""}`);
  const btns = places.map((p) => `<button class="pl" data-p="${esc(p.name)}">${esc(p.name)}</button>`).join(" ");
  const meal = /^(dinner|lunch|breakfast|brunch)/i.test(b || "") || /breakfast|brunch|lunch|dinner/i.test(b || "");
  return `<div class="row${meal ? " meal" : ""}"><div class="t">${esc(a || "")}</div><div class="i"><div class="what">${esc(b || "")}</div>${c ? `<div class="n">${esc(c)}</div>` : ""}${btns ? `<div class="pls">${btns}</div>` : ""}</div></div>`;
}
function bookHtml(rows) {
  let out = ""; let open = false;
  for (const [a, b] of rows) {
    if (!a && !b) { if (open) out += "</div>"; open = false; continue; }
    if (a && !b && !open) { out += `<h3>${esc(a)}</h3><div class="book">`; open = true; continue; }
    if (a && !b && open) { out += `</div><h3>${esc(a)}</h3><div class="book">`; continue; }
    out += `<div class="brow"><b>${esc(a)}</b><span>${esc(b || "")}</span></div>`;
  }
  return out + (open ? "</div>" : "");
}
const plans = src.tabs.filter((t) => t.name !== "Book");
const book = src.tabs.find((t) => t.name === "Book");
const wx = cache.weather;
function wxHtml() {
  const blocks = Object.entries(wx).map(([label, w]) => {
    if (!w.periods?.length) return `<div class="wx"><b>${esc(label)}</b><span>forecast appears about a week out (NWS)</span></div>`;
    return `<div class="wx"><b>${esc(label)}</b>${w.periods.map((p) => `<span><em>${esc(p.name)}</em> ${p.t}°${p.unit} · ${esc(p.short)} · ${esc(p.wind)}</span>`).join("")}<small>nws, fetched ${w.fetched}</small></div>`;
  });
  return blocks.join("");
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Manitou — Oct 9–12</title>
<meta name="description" content="Rohin's Manitou Springs trip, Oct 9–12 2026. Personal notes only.">
<meta name="theme-color" content="#FBF9F6">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='38' fill='%23A8442F'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..800;1,300..800&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&display=swap" rel="stylesheet">
<style>
:root{--paper:#FBF9F6;--paper-2:#F5F1EA;--paper-3:#EFEAE1;--ink:#1C1917;--ink-2:#57514A;--ink-3:#8B8279;--rule:#E4DDD2;--rule-2:#EDE7DD;--eat:#A8442F;--drink:#35636F;--act:#9A4667;
--sans:"Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;--serif:"Fraunces",Georgia,serif;
--grain:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(%23n)' opacity='.04'/></svg>")}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:var(--sans);font-size:15px;color:var(--ink);background:var(--paper) var(--grain);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;display:flex;flex-direction:column}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}a{color:inherit}h1,h2,h3{margin:0;font-weight:inherit}
header{background:var(--paper);border-bottom:1px solid var(--rule);position:sticky;top:0;z-index:40}
.hrow{display:flex;align-items:flex-end;gap:26px;padding:16px 28px 12px;max-width:1500px;margin:0 auto}
.brand{display:flex;align-items:baseline;gap:10px;line-height:1}
.brand b{font-family:var(--serif);font-weight:600;font-size:27px;letter-spacing:-.018em;font-variation-settings:"opsz" 40}
.brand span{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);font-weight:500;padding-bottom:2px}
.brand span a{text-decoration:none}.brand span a:hover{color:var(--ink)}
.dates{margin-left:auto;font-family:var(--serif);font-style:italic;color:var(--ink-2);font-size:15px}
.tabs{display:flex;gap:22px;padding:0 28px;overflow-x:auto;scrollbar-width:none;max-width:1500px;margin:0 auto}
.tab{white-space:nowrap;padding:9px 0 10px;font-size:13px;color:var(--ink-3);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.tab:hover{color:var(--ink-2)}.tab.on{color:var(--ink);border-bottom-color:var(--ink)}
main{flex:1;display:flex;max-width:1500px;margin:0 auto;width:100%;min-height:0}
#plan{flex:1;padding:8px 28px 60px;min-width:0}
#side{width:38%;max-width:520px;min-width:320px;border-left:1px solid var(--rule);padding:22px 26px 60px;position:sticky;top:96px;align-self:flex-start;max-height:calc(100vh - 96px);overflow-y:auto}
.pane{display:none}.pane.on{display:block}
.day{font-family:var(--serif);font-size:22px;margin:30px 0 8px;display:flex;align-items:baseline;gap:10px}.day small{font-family:var(--sans);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.row{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:8px 0;border-top:1px solid var(--rule-2)}
.row .t{font-size:13px;color:var(--ink-3);padding-top:2px}.row.meal .t{color:var(--eat)}
.row .what{font-weight:500}.row .n{font-size:13.5px;color:var(--ink-2);margin-top:2px;line-height:1.45}
.row.stay .i{font-family:var(--serif);font-style:italic;color:var(--ink-2)}
.pls{margin-top:5px;display:flex;flex-wrap:wrap;gap:6px}
.pl{font-size:12px;padding:3px 9px;border:1px solid var(--rule);border-radius:999px;color:var(--ink-2);background:var(--paper)}.pl:hover,.pl.on{border-color:var(--ink);color:var(--ink)}
.gap{height:6px}
h3{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:26px 0 8px;font-weight:600}
.book .brow{display:grid;grid-template-columns:220px 1fr;gap:12px;padding:7px 0;border-top:1px solid var(--rule-2);font-size:14px}.book .brow b{font-weight:500}.book .brow span{color:var(--ink-2)}
#card .ph{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:var(--paper-3);filter:sepia(.1) saturate(.9)}
#card h2{font-family:var(--serif);font-size:24px;margin:14px 0 2px}
#card .type{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
#card .note{font-family:var(--serif);font-style:italic;color:var(--ink-2);margin:10px 0 14px;font-size:15.5px}
#card dl{margin:0;font-size:13.5px}#card dt{color:var(--ink-3);font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-top:10px}#card dd{margin:2px 0 0;color:var(--ink-2)}
#card .hrs{white-space:pre-line}#card .links{margin-top:14px;display:flex;gap:14px;font-size:13px}
.empty{color:var(--ink-3);font-family:var(--serif);font-style:italic;margin-top:40px}
.wx{border-top:1px solid var(--rule-2);padding:8px 0;font-size:13.5px;display:flex;flex-direction:column;gap:3px}.wx b{font-weight:500}.wx span em{font-style:normal;color:var(--ink-3)}.wx small{color:var(--ink-3)}
@media (max-width:860px){main{flex-direction:column}#side{width:auto;max-width:none;min-width:0;border-left:0;border-top:1px solid var(--rule);position:static;max-height:none;padding:18px 20px 40px}#plan{padding:8px 20px 20px}.hrow{padding:14px 20px 10px;gap:14px}.dates{display:none}.tabs{padding:0 20px}.book .brow{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div class="hrow">
    <div class="brand"><b>Manitou</b><span><a href="/">Seattle</a> &middot; <a href="/nyc/">New York</a> &middot; <a href="/colorado/">Colorado</a></span></div>
    <div class="dates">${esc(src.dates)} &middot; ${esc(src.home)}</div>
  </div>
  <nav class="tabs">${plans.map((t, i) => `<button class="tab${i === 0 ? " on" : ""}" data-t="${i}">${esc(t.name)}</button>`).join("")}<button class="tab" data-t="book">Book</button><button class="tab" data-t="wx">Weather</button></nav>
</header>
<main>
  <section id="plan">
    ${plans.map((t, i) => `<div class="pane${i === 0 ? " on" : ""}" data-pane="${i}">${t.rows.map(rowHtml).join("")}</div>`).join("")}
    <div class="pane" data-pane="book">${bookHtml(book.rows)}</div>
    <div class="pane" data-pane="wx"><h3>Forecast</h3>${wxHtml()}</div>
  </section>
  <aside id="side"><div id="card"><div class="empty">tap a place in the plan</div></div></aside>
</main>
<script>
const P = ${JSON.stringify(placeData)};
const card = document.getElementById('card');
function show(name){
  const p = P[name]; if(!p) return;
  document.querySelectorAll('.pl').forEach(b=>b.classList.toggle('on', b.dataset.p===name));
  card.innerHTML = (p.photo?'<img class="ph" src="'+p.photo+'" alt="">':'') +
    '<div class="type" style="margin-top:14px">'+p.type+' · '+p.hood+'</div><h2>'+p.name+'</h2>' +
    (p.note?'<div class="note">'+p.note+'</div>':'') + '<dl>' +
    (p.drive?'<dt>Drive</dt><dd>'+p.drive+'</dd>':'') +
    (p.address?'<dt>Address</dt><dd>'+p.address+'</dd>':'') +
    (p.phone?'<dt>Phone</dt><dd><a href="tel:'+p.phone.replace(/[^0-9+]/g,'')+'">'+p.phone+'</a></dd>':'') +
    (p.hours.length?'<dt>Hours</dt><dd class="hrs">'+p.hours.join('\\n')+'</dd>':'') +
    (p.price?'<dt>Price</dt><dd>'+p.price+'</dd>':'') + '</dl>' +
    '<div class="links">'+(p.maps?'<a href="'+p.maps+'" target="_blank" rel="noopener">google maps</a>':'')+(p.web?'<a href="'+p.web+'" target="_blank" rel="noopener">website</a>':'')+'</div>';
  if (window.innerWidth<=860) document.getElementById('side').scrollIntoView({behavior:'smooth'});
}
document.addEventListener('click', e => {
  const b = e.target.closest('.pl'); if (b) return show(b.dataset.p);
  const t = e.target.closest('.tab'); if (t) {
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on', x===t));
    document.querySelectorAll('.pane').forEach(x=>x.classList.toggle('on', x.dataset.pane===t.dataset.t));
    history.replaceState(null,'','#'+t.dataset.t);
  }
});
if (location.hash) { const t=document.querySelector('.tab[data-t="'+location.hash.slice(1)+'"]'); if(t) t.click(); }
</script>
</body>
</html>`;

mkdirSync(join(ROOT, "manitou"), { recursive: true });
writeFileSync(join(ROOT, "manitou", "index.html"), html);
console.log(`Built manitou/index.html with ${Object.keys(placeData).length} place cards.`);

/* add a Manitou link to the other pages (they're regenerated each run, so this runs last) */
function addLink(path, from, to) {
  if (!existsSync(path)) return;
  const t = readFileSync(path, "utf8");
  if (t.includes(from) && !t.includes(to)) { writeFileSync(path, t.replace(from, to)); console.log(`Linked Manitou from ${path}`); }
}
addLink(join(ROOT, "index.html"), '<a href="/colorado/">Colorado</a></span>', '<a href="/colorado/">Colorado</a> &middot; <a href="/manitou/">Manitou</a></span>');
addLink(join(ROOT, "nyc", "index.html"), '<a href="/colorado/">Colorado</a></span>', '<a href="/colorado/">Colorado</a> &middot; <a href="/manitou/">Manitou</a></span>');
addLink(join(ROOT, "colorado", "index.html"), '<a href="/nyc/">New York</a></span>', '<a href="/nyc/">New York</a> &middot; <a href="/manitou/">Manitou</a></span>');
