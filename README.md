# wr-vylety-mapa — Klikací mapa cyklovýletů

Statická mobile-first stránka (iPhone) se 3 přepínatelnými cyklovýlety za
technickými památkami z Prahy: **Zdymadlo Hořín**, **Pivovar Lobeč**,
**Hvězdárna Ondřejov**. U každého: trasa na mapě, zastávky, výškový profil,
kilometrovník á 5 km, odhad času pro rodinu s menšími dětmi.

> ⚠️ **Tento adresář vznikl v repu `cml` (vývoj z mobilu) a je určený
> k přesunu do samostatného public repa `whiterabbitcz-dev/wr-vylety-mapa`**
> s nasazením na GitHub Pages. Je plně self-contained — stačí obsah adresáře
> zkopírovat do rootu nového repa.

## Stack

- **Mapa:** Leaflet 1.9.4 + rastrové dlaždice Mapy.com REST API (styl
  `outdoor`), povinná atribuce (logo + copyright) dle
  [tutoriálu](https://developer.mapy.com/rest-api-mapy-cz/tutorials/map-display/).
  Fallback řetěz když klíč/limit selže: Mapy.com → CyclOSM → OSM.
- **Výškový profil:** leaflet-elevation 2.5.2 (tap na profilu → bod na mapě).
  Všechny závislosti (d3, togeojson, …) jsou **vendorované lokálně** ve
  `vendor/` — plugin je normálně tahá z unpkg, což je v `js/app.js`
  přesměrované, aby byl web self-contained.
- **Kilometrovník:** turf.js `along`, značky á 5 km.
- **Data tras:** statické GPX v `data/` — **žádný runtime routing**, žádné
  runtime placené volání.

## Klíče (oba v 1Password)

| Klíč | Kde žije | Poznámka |
|---|---|---|
| ORS (openrouteservice.org) | jen build-time env `ORS_API_KEY` | do klienta se NEPOSÍLÁ, necommituje se |
| Mapy.com | `js/config.js` (client-side) | před commitem **omezit na doménu GH Pages** v developer konzoli |

Bez Mapy.com klíče appka běží na CyclOSM fallbacku (pro vývoj stačí);
klíč jde dočasně předat i přes `?mapykey=XXX`.

## Pipeline generování tras (spouští se na MacBooku)

```bash
ORS_API_KEY=xxx node scripts/build_routes.mjs all   # nebo trip1|trip2|trip3
```

1. Skript zavolá ORS Directions (`cycling-regular`, `elevation=true`),
   zapíše `data/tripN.gpx` s výškami z DEM a **dopočítá km pozice zastávek**
   ve `stops.json`.
2. **DRIFT CONTROL (kritické):** ORS nedrží značené cyklotrasy (č. 7, 0008,
   0020…). Trasy jsou seedované hustými průjezdními body ve
   `scripts/waypoints.mjs` — po vygenerování každou trasu **vizuálně přelož
   přes cyklovrstvu Mapy.com** a kde ujíždí, přidej mezibod a přegeneruj.
3. Teprve po vizuální kontrole GPX zmrazit (commit).

Skript zároveň vypíše délku/převýšení/model času a varuje, když je zastávka
dál než 300 m od trasy (= špatná souřadnice nebo špatný koridor).

## Model času (rodina s menšími dětmi)

- Jízdní tempo **11 km/h** na rovině (rozmezí 10–12).
- Stoupání: přirážka **~1 min / 10 m převýšení**.
- Prohlídky se počítají **zvlášť** (součet `prohlidka_min` ze `stops.json`)
  a zobrazuje se i celkový čas s prohlídkami.
- Překročí-li výlet **>25 km čisté jízdy NEBO >300 m převýšení**, UI ukáže
  badge „Náročnější“ a zkrácenou variantu z `trips.json`.
- Převýšení = součet kladných rozdílů po vyhlazení výšek (klouzavý průměr,
  okno 5) — stejný výpočet v build skriptu i v UI. Výšky vždy z GPX (ORS
  DEM), **nic se nefabrikuje**.

## Struktura

```
index.html          – UI: taby → mapa → profil → info panel
css/style.css       – mobile-first, safe-area pro iPhone
js/config.js        – MAPY_API_KEY (client-side)
js/app.js           – mapa, fallback podkladů, GPX, profil, km značky, model času
data/trips.json     – metadata výletů (popisy, značené trasy, zkrácené varianty)
data/stops.json     – zastávky: {trip, name, lat, lng, km, popis, prohlidka_min}
data/trip{1..3}.gpx – zmrazené trasy (výstup pipeline; zatím NEVYGENEROVÁNO)
scripts/waypoints.mjs    – seed průjezdní body pro ORS (drift control)
scripts/build_routes.mjs – ORS → GPX + km zastávek + statistiky
vendor/             – Leaflet, leaflet-elevation (+ d3, togeojson…), turf
```

Dokud GPX neexistuje, appka zobrazí zastávky a hlášku, že trasa čeká na
vygenerování — nic nespadne.

## Deploy (GitHub Pages)

1. Založit public repo `whiterabbitcz-dev/wr-vylety-mapa` (GitHub App na to
   nemá právo — ručně v UI), obsah tohoto adresáře do rootu, push na `main`.
2. Pages se aktivují samy: `.github/workflows/pages.yml` má
   `configure-pages` s `enablement: true` — první push na `main` web nasadí
   na `https://whiterabbitcz-dev.github.io/wr-vylety-mapa/`.
3. V developer konzoli Mapy.com omezit klíč na `whiterabbitcz-dev.github.io`
   a klíč zapsat do `js/config.js`.

## TODO

- [x] ~~Vygenerovat GPX~~ (2026-07-18): `trip1` 24.2 km / 163 m,
      `trip2` 36.3 km / 902 m (Skramouš drží koridor Mšeno↔Lobeč),
      `trip3` 23.1 km / 465 m. ORS klíč v 1P: „HeiGIT ORS_API_KEY".
- [x] ~~Ověřit reálná data na sezónu 2026~~ (web, 2026-07-18):
      - Cyklovlak „Kokořínský rychlík": so/ne/svátky 21. 3.–1. 11. 2026,
        Praha hl. n. 8:37 → Mšeno, zpět z Mšena 16:44, ~20 kol.
      - Pivovar Lobeč: prohlídky 14:30 (čvc–srp pá/so/ne; jaro/podzim jen
        víkendy), 75 min / 150 Kč, děti do 15 let zdarma.
      - Hvězdárna Ondřejov: víkendy a svátky V–IX, 10/13/16 h, ~2 h, jen hotově.
      - ⚠️ Památník J. Lady v Hrusicích: **od 1. 10. 2025 do odvolání zavřen**
        (rekonstrukce) — v datech zohledněno, před výletem ověřit.
- [x] ~~Souřadnice~~ (2026-07-18): všechny body geokódované
      (Mapy.com geocode + Nominatim), 16 zastávek opraveno, žádný
      `coords_overit: true` nezbyl.
- [ ] Vizuální drift-kontrola tras proti značeným cyklotrasám (č. 7, 0008,
      0020/0023/0025): předfiltr v náhledu proběhl (koridory sedí), finální
      kontrola nad cyklovrstvou Mapy.com = Martin; pak GPX zmrazit.
- [x] ~~Mapy.com klíč zapsat do config.js, klíče do 1P~~ (2026-07-18);
      zbývá doménové omezení na `whiterabbitcz-dev.github.io` (Martin,
      developer konzole Mapy.com).
- [ ] Otestovat na skutečném iPhonu (tap na profil, popupy, safe-area).

## Herní vrstva (data)

Obsah hry je v JSON — výměna placeholderů = editace dvou souborů, žádný kód:

- **`data/trips.json`** per mise: `mission_number`, `mission_title`,
  `mission_subtitle`, `xp_value` (bonus za dokončení mise; mise s variantami
  může mít druhou hodnotu ve `varianta_alt.xp_value`, přizná se podle varianty
  aktivní při dokončení a uloží do snapshotu),
  `scavenger: [{id, text, icon}]` (foto-hledačka, 3–5 položek, +10 XP/kus),
  `rabbit_hint` (stálý úkol „vyfoť králíka", +25 XP),
  `facts: [{stop_id, fact}]` („víš, že…" u zastávek; `stop_id` viz `id`
  ve `stops.json`).
- **`data/stops.json`**: `id` (referencují ho fakta), `photo_spot: true`
  (ikonka „super místo na fotku").
- **`data/badges.json`**: `badges: [{id, name, description, icon, condition}]`;
  `condition` je `{type: "auto", metric, gte}` s metrikami `missions_done`,
  `km_total`, `climb_total`, `xp`, `rabbits_done` (počet misí s vyfoceným
  králíkem; vše ratchet, odemčené nezhasíná), nebo
  `{type: "manual"}` (self-check ťuknutím v polici odznaků).

Postup hráčky žije v localStorage (`wr-vylety-mapa.progress`,
`schema_version: 1`): odškrtnuté položky, hotové mise (se snapshotem
km/převýšení pro auto odznaky), odznaky, pozice navigátoru. XP se neukládá,
počítá se vždy ze stavu. Záloha/obnova = JSON přes textarea v modalu
Skóre a odznaky; tamtéž reset. PWA manifest → „přidat na plochu".
