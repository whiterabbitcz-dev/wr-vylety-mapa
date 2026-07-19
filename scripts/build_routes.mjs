#!/usr/bin/env node
// Build-time generování GPX tras přes OpenRouteService (headless).
//
// Použití:
//   ORS_API_KEY=xxx node scripts/build_routes.mjs [all|trip1|trip2|trip3]
//
// Co dělá:
//   1. Pro každý výlet zavolá ORS Directions, profil `cycling-regular`,
//      elevation=true → 3D geometrie (výšky z DEM, nic se nefabrikuje).
//   2. Zapíše data/<trip>.gpx (trkpt s <ele> přímo z ORS odpovědi).
//   3. Dopočítá km pozici každé zastávky ve stops.json (nejbližší bod na
//      trase) a soubor aktualizuje; varuje, když je zastávka >300 m od trasy.
//   4. Vypíše statistiky (délka, převýšení, model času) pro ruční kontrolu.
//
// Klíč ORS je BUILD-TIME ONLY — do klienta se neposílá, necommituje se
// (žije v 1Password / env). Free tier: 2000 req/den, bohatě stačí.
//
// DRIFT CONTROL: po vygenerování trasu vizuálně přelož přes cyklovrstvu
// Mapy.com; kde ujíždí ze značené trasy, přidej mezibod do waypoints.mjs
// a přegeneruj. Teprve pak GPX commitni.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trips } from "./waypoints.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const orsUrl = (profile) =>
  `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

const API_KEY = process.env.ORS_API_KEY;
if (!API_KEY) {
  console.error("Chybí ORS_API_KEY (build-time klíč z openrouteservice.org, viz 1Password).");
  process.exit(1);
}

const arg = process.argv[2] || "all";
const selected = arg === "all" ? Object.keys(trips) : [arg];
for (const t of selected) {
  if (!trips[t]) {
    console.error(`Neznámá trasa '${t}'. Možnosti: all, ${Object.keys(trips).join(", ")}`);
    process.exit(1);
  }
}

// Mapování route id (klíč ve waypoints.mjs) → výlet, GPX soubor, pole pro km
// zastávek a filtr zastávek. Výlet 2 má dvě varianty: default (zkrácená,
// bez zastávek s `varianta: "plna"`) a plná (všechny zastávky, km_plna).
const ROUTES = {
  trip0:      { trip: "trip0", gpx: "trip0.gpx",      kmField: "km",      label: " (pěšky)",      stopFilter: (s) => s.varianta !== "plna", profile: "foot-walking" },
  trip1:      { trip: "trip1", gpx: "trip1.gpx",      kmField: "km",      label: "",              stopFilter: (s) => s.varianta !== "plna" },
  trip2:      { trip: "trip2", gpx: "trip2.gpx",      kmField: "km",      label: "",              stopFilter: (s) => s.varianta !== "plna" },
  trip2_plna: { trip: "trip2", gpx: "trip2_plna.gpx", kmField: "km_plna", label: " (plná verze)", stopFilter: () => true },
  trip3:      { trip: "trip3", gpx: "trip3.gpx",      kmField: "km",      label: "",              stopFilter: (s) => s.varianta !== "plna" },
};

// ---------------------------------------------------------------- geometrie

const R = 6371; // km

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function lengthKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += haversineKm(coords[i - 1], coords[i]);
  return s;
}

// Stejný algoritmus jako v js/app.js: klouzavý průměr (okno 5), součet
// kladných rozdílů. Ať čísla v konzoli sedí s tím, co ukáže web.
function elevationGain(coords) {
  const eles = coords.map((c) => c[2]);
  if (eles.some((e) => e == null || !Number.isFinite(e))) return null;
  const W = 2;
  const smooth = eles.map((_, i) => {
    const a = Math.max(0, i - W);
    const b = Math.min(eles.length - 1, i + W);
    let s = 0;
    for (let j = a; j <= b; j++) s += eles[j];
    return s / (b - a + 1);
  });
  let gain = 0;
  for (let i = 1; i < smooth.length; i++) {
    const d = smooth[i] - smooth[i - 1];
    if (d > 0) gain += d;
  }
  return Math.round(gain);
}

// Nejbližší bod trasy k zastávce → km pozice + vzdálenost od trasy.
function stopOnRoute(coords, cumKm, stop) {
  let best = { km: null, distKm: Infinity };
  for (let i = 0; i < coords.length; i++) {
    const d = haversineKm(coords[i], [stop.lng, stop.lat]);
    if (d < best.distKm) best = { km: cumKm[i], distKm: d };
  }
  return best;
}

// ---------------------------------------------------------------- model času

const RIDE_SPEED_KMH = 11;
const CLIMB_MIN_PER_10M = 1;

function fmtTime(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

// ---------------------------------------------------------------- GPX

function toGpx(tripId, name, coords) {
  const pts = coords
    .map(
      (c) =>
        `      <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}"><ele>${(c[2] ?? 0).toFixed(1)}</ele></trkpt>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="wr-vylety-mapa build_routes.mjs (ORS cycling-regular, elevation=true)"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name></metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

// ---------------------------------------------------------------- main

const tripsMeta = JSON.parse(readFileSync(join(ROOT, "data/trips.json"), "utf8")).trips;
const stops = JSON.parse(readFileSync(join(ROOT, "data/stops.json"), "utf8"));

for (const tripId of selected) {
  const waypoints = trips[tripId];
  const route = ROUTES[tripId];
  const meta = tripsMeta.find((t) => t.id === route.trip);
  console.log(`\n═══ ${(meta?.nazev ?? tripId) + route.label} ═══`);
  console.log(`ORS request: ${waypoints.length} průjezdních bodů…`);

  const res = await fetch(orsUrl(route.profile || "cycling-regular"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: API_KEY,
    },
    body: JSON.stringify({
      coordinates: waypoints,
      elevation: true,
      instructions: false,
      preference: "recommended",
    }),
  });

  if (!res.ok) {
    console.error(`ORS selhal (${res.status}): ${await res.text()}`);
    process.exit(1);
  }

  const geojson = await res.json();
  const coords = geojson.features?.[0]?.geometry?.coordinates;
  if (!coords?.length) {
    console.error("ORS nevrátil geometrii:", JSON.stringify(geojson).slice(0, 500));
    process.exit(1);
  }
  if (coords[0].length < 3) {
    console.error("Geometrie nemá výšky — zkontroluj elevation=true.");
    process.exit(1);
  }

  // GPX
  const gpxPath = join(ROOT, "data", route.gpx);
  writeFileSync(gpxPath, toGpx(tripId, (meta?.nazev ?? tripId) + route.label, coords));

  // statistiky
  const km = lengthKm(coords);
  const gain = elevationGain(coords);
  const cumKm = [0];
  for (let i = 1; i < coords.length; i++)
    cumKm.push(cumKm[i - 1] + haversineKm(coords[i - 1], coords[i]));

  const tempo = meta?.tempo_kmh || RIDE_SPEED_KMH; // pěší mise mají vlastní tempo v datech
  const rideMin = (km / tempo) * 60 + (gain / 10) * CLIMB_MIN_PER_10M;
  const tripStops = stops.filter((s) => s.trip === route.trip && route.stopFilter(s));
  const visitsMin = tripStops.reduce((a, s) => a + (s.prohlidka_min || 0), 0);

  console.log(`✓ ${gpxPath}`);
  console.log(`  délka:      ${km.toFixed(1)} km`);
  console.log(`  převýšení:  ↑ ${gain} m`);
  console.log(`  jízda:      ≈ ${fmtTime(rideMin)} (tempo ${tempo} km/h + kopce)`);
  console.log(`  s prohlídkami: ≈ ${fmtTime(rideMin + visitsMin)} (prohlídky ${fmtTime(visitsMin)})`);
  if (km > 25 || gain > 300) {
    console.log(`  ⚠ NÁROČNĚJŠÍ (limit 25 km / 300 m) — zkontroluj zkrácenou variantu v trips.json`);
  }

  // km pozice zastávek (u variantních tras do vlastního pole, např. km_plna).
  // Zastávky se `zaver: true` (návrat na start u okruhu) dostanou celkovou
  // délku — nearest-point by jim přiřadil km 0 a rozhodil pořadí v UI.
  for (const s of tripStops) {
    const { km: atKm, distKm } = s.zaver
      ? { km: cumKm[cumKm.length - 1], distKm: 0 }
      : stopOnRoute(coords, cumKm, s);
    s[route.kmField] = Math.round(atKm * 10) / 10;
    const flag = distKm > 0.3 ? `  ⚠ ${Math.round(distKm * 1000)} m od trasy — ověř polohu/koridor!` : "";
    console.log(`  zastávka km ${String(s[route.kmField]).padStart(5)}  ${s.name}${flag}`);
  }

  await new Promise((r) => setTimeout(r, 1500)); // šetrnost k free tieru
}

writeFileSync(join(ROOT, "data/stops.json"), JSON.stringify(stops, null, 2) + "\n");
console.log("\n✓ data/stops.json aktualizován (km pozice zastávek).");
console.log("→ Teď vizuální kontrola: trasy přelož přes cyklovrstvu Mapy.com (viz README).");
