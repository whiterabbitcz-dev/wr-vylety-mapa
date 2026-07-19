/* Cyklovýlety — technické památky z Prahy
 *
 * Statická mobile-first appka: 3 přepínatelné výlety, trasa z GPX v repu,
 * výškový profil (leaflet-elevation), kilometrovník (turf.along),
 * model času pro rodinu s menšími dětmi.
 *
 * Žádné runtime placené volání — jediný klientský klíč jsou dlaždice Mapy.com,
 * s fallbackem na CyclOSM/OSM, když klíč/limit selže.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- konstanty

  var RIDE_SPEED_KMH = 11;          // jízdní tempo na rovině (rozmezí 10–12)
  var CLIMB_MIN_PER_10M = 1;        // přirážka ~1 min na 10 m převýšení
  var HARD_KM = 25;                 // limit čisté jízdy pro rodinný budget
  var HARD_GAIN_M = 300;            // limit převýšení pro rodinný budget
  var KM_MARKER_STEP = 5;           // kilometrovník á 5 km

  var MAPY_KEY =
    new URLSearchParams(location.search).get("mapykey") ||
    (window.CONFIG && window.CONFIG.MAPY_API_KEY) ||
    "";

  // leaflet-elevation si své závislosti normálně lazy-loaduje z unpkg.com —
  // přesměrování na lokální vendor kopie, ať je web self-contained.
  var abs = function (p) { return new URL(p, document.baseURI).href; };
  Object.assign(L.Control.Elevation.prototype, {
    __D3: abs("vendor/deps/d3.min.js"),
    __TOGEOJSON: abs("vendor/deps/togeojson.umd.js"),
    __LGEOMUTIL: abs("vendor/deps/leaflet.geometryutil.js"),
    __LALMOSTOVER: abs("vendor/deps/leaflet.almostover.js"),
  });

  // ---------------------------------------------------------------- mapa

  var map = L.map("map", { zoomControl: true, preferCanvas: false })
    .setView([50.15, 14.65], 10);
  window.__map = map; // debug hook (harness/testy)

  // Flex/dvh layout (safe-area na iOS) se může dopočítat až po initu mapy —
  // dlaždice by se pak kreslily jen v pásu původní velikosti kontejneru.
  // Leaflet sleduje jen window resize, ne velikost kontejneru; ResizeObserver
  // pokryje každou změnu (dopočet flexu, rotace, schování lišty Safari).
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () {
      map.invalidateSize();
      checkLayout(); // breakpoint hlídáme i tady — resize/matchMedia eventy
                     // jsou v některých webview nespolehlivé
    }).observe(document.getElementById("map"));
  } else {
    window.addEventListener("load", function () { map.invalidateSize(); });
  }

  // Atribuce: jeden kompaktní blok v rohu — logo Mapy.com (povinné) je inline
  // součástí attribution controlu, žádný samostatný logo control.
  map.attributionControl.setPrefix(false);

  // Řetěz podkladů: Mapy.com outdoor → CyclOSM → OSM. Když vrstva nevydá ani
  // jednu dlaždici a nasype chyby, přepneme na další v řadě.
  var baseLayers = [
    MAPY_KEY && {
      name: "mapy",
      make: function () {
        return L.tileLayer(
          "https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=" + MAPY_KEY,
          {
            minZoom: 0,
            maxZoom: 19,
            attribution:
              '<a href="https://mapy.com/" target="_blank" rel="noopener" class="mapy-attrib-logo">' +
              '<img src="https://api.mapy.com/img/api/logo.svg" alt="Mapy.com"></a> ' +
              '<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>',
          }
        );
      },
      // Mapy.com při neplatném klíči / vyčerpaném limitu vrací 403, ale tělem
      // je dekódovatelný PNG — <img> ho „načte" a tileerror nikdy nenastane.
      // Status proto ověříme fetchem; chybová odpověď navíc nemá CORS
      // hlavičky, takže i reject znamená selhání klíče.
      probe: function () {
        return fetch(
          "https://api.mapy.com/v1/maptiles/outdoor/256/0/0/0?apikey=" + MAPY_KEY
        )
          .then(function (r) { return r.ok; })
          .catch(function () { return false; });
      },
    },
    {
      name: "cyclosm",
      make: function () {
        return L.tileLayer(
          "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            subdomains: "abc",
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> | dlaždice <a href="https://www.cyclosm.org" target="_blank">CyclOSM</a>',
          }
        );
      },
    },
    {
      name: "osm",
      make: function () {
        return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        });
      },
    },
  ].filter(Boolean);

  var baseIdx = -1;
  var currentBase = null;

  function useBase(idx) {
    if (idx >= baseLayers.length) return; // poslední vrstvu už necháme být
    if (currentBase) {
      map.removeLayer(currentBase);
      if (baseLayers[baseIdx].cleanup) baseLayers[baseIdx].cleanup();
    }
    baseIdx = idx;
    var spec = baseLayers[idx];
    var layer = spec.make();
    var ok = 0, err = 0;
    layer.on("tileload", function () { ok++; });
    layer.on("tileerror", function () {
      err++;
      if (ok === 0 && err >= 3) {
        console.warn("Podklad '" + spec.name + "' selhal, přepínám na fallback.");
        useBase(baseIdx + 1);
      }
    });
    currentBase = layer.addTo(map);
    if (spec.probe) {
      spec.probe().then(function (keyOk) {
        if (!keyOk && baseIdx === idx) {
          console.warn("Podklad '" + spec.name + "' neprošel kontrolou klíče, přepínám na fallback.");
          useBase(idx + 1);
        }
      });
    }
  }

  useBase(0);

  // ---------------------------------------------------------------- utilitky

  function fmtTime(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h === 0) return m + " min";
    return h + " h " + (m < 10 ? "0" : "") + m + " min";
  }

  function el(id) { return document.getElementById(id); }

  // Cache-busting datových souborů: build stamp vkládá Pages workflow do
  // window.BUILD — každý deploy má nová URL a stará cache (max-age=600,
  // iOS Safari) se ignoruje. Nenahrazený literál __BUILD__ (lokální vývoj,
  // selhání sedu) se přeskočí a jede se bez verze jako dřív.
  function dataUrl(path) {
    var b = window.BUILD;
    return b && b.indexOf("__") !== 0 ? path + "?v=" + b : path;
  }

  // Vzdálenost dvou bodů [lat, lng] v km (haversine).
  function haversineKm(a, b) {
    var rad = function (d) { return (d * Math.PI) / 180; };
    var dLat = rad(b[0] - a[0]);
    var dLon = rad(b[1] - a[1]);
    var x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  }

  // Klouzavý průměr výšek (okno 5) — stejné vyhlazení pro celkové převýšení
  // i úsekové časy mezi zastávkami.
  function smoothEles(eles) {
    var W = 2;
    return eles.map(function (_, i) {
      var a = Math.max(0, i - W), b = Math.min(eles.length - 1, i + W);
      var s = 0;
      for (var j = a; j <= b; j++) s += eles[j];
      return s / (b - a + 1);
    });
  }

  // GPX → pole [ [lat, lng, ele], ... ] (vlastní parser, ať statistiky
  // nezávisí na interních strukturách pluginu)
  function parseGpx(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    var pts = [];
    doc.querySelectorAll("trkpt").forEach(function (tp) {
      var lat = parseFloat(tp.getAttribute("lat"));
      var lon = parseFloat(tp.getAttribute("lon"));
      var eleNode = tp.querySelector("ele");
      var ele = eleNode ? parseFloat(eleNode.textContent) : null;
      if (isFinite(lat) && isFinite(lon)) pts.push([lat, lon, ele]);
    });
    return pts.length >= 2 ? pts : null;
  }

  function toLineString(pts) {
    return turf.lineString(pts.map(function (p) { return [p[1], p[0]]; }));
  }

  // Převýšení: lehké vyhlazení výšek (klouzavý průměr, okno 5) a součet
  // kladných rozdílů. Zdroj výšek = GPX (DEM z ORS), nic se nefabrikuje.
  function elevationGain(pts) {
    var eles = pts.map(function (p) { return p[2]; });
    if (eles.some(function (e) { return e == null || !isFinite(e); })) return null;
    var smooth = smoothEles(eles);
    var gain = 0;
    for (var i = 1; i < smooth.length; i++) {
      var d = smooth[i] - smooth[i - 1];
      if (d > 0) gain += d;
    }
    return Math.round(gain);
  }

  // Tempo mise: cyklo default 11 km/h, pěší mise si nesou vlastní tempo
  // v datech (tempo_kmh) — žádná logika vázaná na konkrétní id mise.
  function tripTempo(trip) {
    return (trip && trip.tempo_kmh) || RIDE_SPEED_KMH;
  }

  // Úseky mezi zastávkami (à la Mapy.com „3.1 km · 12 min"): z GPX kumulativní
  // vzdálenost + převýšení v úseku, čas stejným modelem jako celek.
  function buildSegments(pts, stops, tempoKmh) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + haversineKm([pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]]));
    }
    var eles = pts.map(function (p) { return p[2]; });
    var hasEle = !eles.some(function (e) { return e == null || !isFinite(e); });
    var smooth = hasEle ? smoothEles(eles) : null;

    function idxAtKm(km) {
      for (var i = 0; i < cum.length; i++) if (cum[i] >= km) return i;
      return cum.length - 1;
    }

    var segs = [];
    for (var s = 0; s < stops.length - 1; s++) {
      var kmA = stopKm(stops[s]), kmB = stopKm(stops[s + 1]);
      if (kmA == null || kmB == null || kmB <= kmA) { segs.push(null); continue; }
      var segKm = kmB - kmA;
      var min = (segKm / (tempoKmh || RIDE_SPEED_KMH)) * 60;
      if (smooth) {
        var gain = 0;
        for (var j = idxAtKm(kmA) + 1; j <= idxAtKm(kmB); j++) {
          var d = smooth[j] - smooth[j - 1];
          if (d > 0) gain += d;
        }
        min += (gain / 10) * CLIMB_MIN_PER_10M;
      }
      segs.push(segKm.toFixed(1) + " km · " + fmtTime(min));
    }
    return segs;
  }

  // ---------------------------------------------------------------- stav výletu

  var state = {
    trips: [],
    stops: [],
    current: null,
    unfocus: false,    // dočasné opuštění soustředěného režimu (Všechny mise)
    variantAlt: false, // u výletu s varianta_alt: false = default (zkrácená), true = plná
    eleControl: null,
    eleLayer: null,
    tripLayers: L.layerGroup().addTo(map),
    kmMarkers: [],   // markery kilometrovníku (kvůli collision s piny)
    stopLatLngs: [], // pozice pinů zastávek (kvůli collision)
    badges: [],      // definice odznaků (badges.json)
    cases: [],       // definice případů (cases.json, story mode)
    lastStats: {},   // {tripId: {km, gain}} — poslední spočtené hodnoty z GPX
  };

  // km pozice zastávky pro aktivní variantu (plná verze má vlastní km_plna)
  function stopKm(stop) {
    return state.variantAlt && stop.km_plna != null ? stop.km_plna : stop.km;
  }

  // ---------------------------------------------------------------- herní vrstva: postup
  //
  // Vše lokálně v localStorage (statický web, jeden telefon, self-reported).
  // XP se NEukládá — počítá se vždy ze zaškrtnutých položek a hotových misí,
  // takže import/úprava zálohy nikdy nerozbije součet.

  var STORAGE_KEY = "wr-vylety-mapa.progress";
  var SCHEMA_VERSION = 1;
  var XP_SCAVENGER = 10; // za položku foto-hledačky
  var XP_RABBIT = 25;    // za králíka

  var progress = loadProgress();

  function defaultProgress() {
    return {
      schema_version: SCHEMA_VERSION,
      checks: {},   // {tripId: {itemId: true, rabbit: true}}
      badges: {},   // {badgeId: true} — odemčené (auto i manuální)
      missions: {}, // {tripId: {done: true, km, gain}} — snapshot pro auto odznaky
      nav: {},      // {tripId: index další zastávky v navigátoru}
      cases: {},    // {caseId: {solved: {cpId: {done, skipped}}, finaleDone}}
    };
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      var p = JSON.parse(raw);
      if (!p || p.schema_version !== SCHEMA_VERSION) return defaultProgress();
      var d = defaultProgress();
      Object.keys(d).forEach(function (k) { if (p[k] == null) p[k] = d[k]; });
      return p;
    } catch (e) {
      return defaultProgress();
    }
  }

  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch (e) { /* private mode apod. — hra jede, jen se neuloží */ }
  }

  function tripChecks(tripId) {
    if (!progress.checks[tripId]) progress.checks[tripId] = {};
    return progress.checks[tripId];
  }

  // Bonus mise podle aktivní varianty (Mise 02: zkrácená 150 / plná 300).
  // Self-reported jako všechno ostatní: platí varianta zapnutá ve chvíli
  // dokončení mise a uloží se do snapshotu, aby se zpětně neměnila.
  function missionXpValue(trip) {
    if (state.variantAlt && trip.varianta_alt && trip.varianta_alt.xp_value != null) {
      return trip.varianta_alt.xp_value;
    }
    return trip.xp_value || 0;
  }

  function computeXp() {
    var xp = 0;
    state.trips.forEach(function (trip) {
      var checks = progress.checks[trip.id] || {};
      (trip.scavenger || []).forEach(function (it) { if (checks[it.id]) xp += XP_SCAVENGER; });
      if (checks.rabbit) xp += XP_RABBIT;
      var m = progress.missions[trip.id];
      if (m && m.done) xp += m.xp != null ? m.xp : trip.xp_value || 0;
    });
    // XP z případů (story mode): jen vyřešené šifry (přeskočené bez XP);
    // iteruje se přes ZNÁMÉ případy, sirotek po smazání se nepočítá
    (state.cases || []).forEach(function (c) {
      var cp = progress.cases[c.id];
      if (!cp || !cp.solved) return;
      (c.checkpoints || []).forEach(function (k) {
        var s = cp.solved[k.id];
        if (s && s.done && !s.skipped) xp += (k.reward && k.reward.xp) || 0;
      });
    });
    return xp;
  }

  function isMissionComplete(trip) {
    var checks = progress.checks[trip.id] || {};
    if (trip.rabbit_hint && !checks.rabbit) return false;
    return (trip.scavenger || []).every(function (it) { return checks[it.id]; });
  }

  // Po každé změně: dokončení mise (se snapshotem km/převýšení pro auto
  // odznaky), vyhodnocení odznaků, přerender XP. Odznak je ratchet — jednou
  // odemčený už nezhasne, i kdyby se metrika snížila (import, odškrtnutí).
  function afterProgressChange() {
    var newlyDone = [];
    state.trips.forEach(function (trip) {
      var m = progress.missions[trip.id];
      if (isMissionComplete(trip)) {
        if (!m || !m.done) {
          var stats = state.lastStats[trip.id] || { km: 0, gain: 0 };
          progress.missions[trip.id] = { done: true, km: stats.km, gain: stats.gain, xp: missionXpValue(trip) };
          newlyDone.push(trip);
        }
      } else if (m && m.done) {
        delete progress.missions[trip.id]; // odškrtla položku → mise zas otevřená
      }
    });
    var newBadges = evalAutoBadges();
    if (typeof awardCaseBadges === "function") awardCaseBadges();
    saveProgress();
    renderXp();
    // WR oslavy: nejdřív mise, pak čerstvé odznaky (fronta, žádné konfety)
    newlyDone.forEach(function (trip) {
      celebrate("🐇", "Mise splněna!", "+" + progress.missions[trip.id].xp + " XP · " + (trip.mission_title || trip.nazev));
    });
    newBadges.forEach(function (b) {
      celebrate(b.icon, "Odznak: " + b.name, b.description);
    });
  }

  function metricValue(metric) {
    // sirotci: postup mise, která už v datech není (např. smazaná cvičná
    // mise), se ignoruje — nesmí přispívat do metrik ani nic shodit
    var known = {};
    state.trips.forEach(function (t) { known[t.id] = true; });
    var missions = Object.keys(progress.missions).filter(function (k) {
      return known[k] && progress.missions[k].done;
    });
    if (metric === "missions_done") return missions.length;
    if (metric === "km_total") return missions.reduce(function (a, k) { return a + (progress.missions[k].km || 0); }, 0);
    if (metric === "climb_total") return missions.reduce(function (a, k) { return a + (progress.missions[k].gain || 0); }, 0);
    if (metric === "xp") return computeXp();
    if (metric === "rabbits_done") {
      return state.trips.filter(function (t) {
        return progress.checks[t.id] && progress.checks[t.id].rabbit;
      }).length;
    }
    if (metric === "cases_done") {
      return (state.cases || []).filter(function (c) {
        return progress.cases[c.id] && progress.cases[c.id].finaleDone;
      }).length;
    }
    return 0;
  }

  function evalAutoBadges() {
    var fresh = [];
    (state.badges || []).forEach(function (b) {
      if (b.condition.type !== "auto" || progress.badges[b.id]) return;
      if (metricValue(b.condition.metric) >= b.condition.gte) {
        progress.badges[b.id] = true;
        fresh.push(b);
      }
    });
    return fresh;
  }

  // WR oslava: střídmý žlutý záblesk v brand barvě, fronta (mise + odznaky
  // můžou přijít naráz). Tap přeskočí.
  var celebrateQueue = [];
  var celebrating = false;

  function celebrate(icon, title, sub) {
    celebrateQueue.push({ icon: icon, title: title, sub: sub });
    runCelebration();
  }

  function runCelebration() {
    if (celebrating || !celebrateQueue.length) return;
    celebrating = true;
    var c = celebrateQueue.shift();
    var box = el("celebrate");
    el("celebrate-icon").textContent = c.icon;
    el("celebrate-title").textContent = c.title;
    el("celebrate-sub").textContent = c.sub || "";
    box.hidden = false;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    var timer = setTimeout(close, 2000);
    function close() {
      clearTimeout(timer);
      box.hidden = true;
      box.removeEventListener("click", close);
      celebrating = false;
      runCelebration();
    }
    box.addEventListener("click", close);
  }

  // XP naskakuje animovaně (count-up + poskočení chipu), ne skokem.
  // setInterval místo requestAnimationFrame: rAF některé webview škrtí
  // a číslo by zůstalo viset na staré hodnotě.
  var displayedXp = 0;
  var xpTimer = null;
  function renderXp() {
    var target = computeXp();
    if (target === displayedXp) {
      el("xp-value").textContent = target;
      el("xp-hero-value").textContent = target;
      return;
    }
    if (target > displayedXp) {
      var chip = el("xp-button");
      chip.classList.remove("bump");
      void chip.offsetWidth; // restart animace
      chip.classList.add("bump");
    }
    var from = displayedXp;
    var delta = target - from;
    var t0 = Date.now();
    var dur = 600;
    displayedXp = target;
    if (xpTimer) clearInterval(xpTimer);
    xpTimer = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / dur);
      p = 1 - Math.pow(1 - p, 3); // ease-out
      var v = Math.round(from + delta * p);
      el("xp-value").textContent = v;
      el("xp-hero-value").textContent = v;
      if (p >= 1) { clearInterval(xpTimer); xpTimer = null; }
    }, 33);
  }

  // Outline ikony (lucide), inline kvůli self-contained buildu bez CDN.
  function iconSvg(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICONS = {
    bike: iconSvg('<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>'),
    mountain: iconSvg('<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>'),
    clock: iconSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    train: iconSvg('<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="m6 19-2 3"/><path d="m18 19 2 3"/>'),
    camera: iconSvg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
    info: iconSvg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    mapFold: iconSvg('<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.895l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'),
    trophy: iconSvg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
  };

  function isStation(stop) {
    return /žel\. stanice/.test(stop.name);
  }

  function clearTrip() {
    state.tripLayers.clearLayers();
    state.kmMarkers = [];
    state.stopLatLngs = [];
    if (state.eleLayer) { map.removeLayer(state.eleLayer); state.eleLayer = null; }
    if (state.eleControl) { state.eleControl.remove(); state.eleControl = null; }
    el("elevation").innerHTML = "";
  }

  // Kilometrovník nekreslit, když by badge kolidoval s pinem zastávky nebo
  // s už vykresleným km badgem (< 24 px; u okruhů se tam-a-zpět badge kryjí).
  // Přepočítává se při zoomu/posunu.
  function updateKmCollisions() {
    if (!state.kmMarkers.length) return;
    var kept = state.stopLatLngs.map(function (ll) {
      return map.latLngToContainerPoint(ll);
    });
    state.kmMarkers.forEach(function (m) {
      var elm = m.getElement();
      if (!elm) return;
      var p = map.latLngToContainerPoint(m.getLatLng());
      var collides = kept.some(function (kp) {
        return p.distanceTo(kp) < 24;
      });
      elm.style.visibility = collides ? "hidden" : "visible";
      if (!collides) kept.push(p);
    });
  }
  map.on("zoomend moveend", updateKmCollisions);

  // Piny: nádraží (start/cíl) = tmavý pin s vlakem, mezizastávky = žlutý pin
  // s pořadovým číslem (_pin přiřazeno v showTrip podle pořadí na trase).
  function stopMarker(stop) {
    var isTrain = stop._pin === "train";
    var m = L.marker([stop.lat, stop.lng], {
      icon: L.divIcon({
        className: "pin " + (isTrain ? "pin-train" : "pin-num"),
        html: '<div class="pin-inner">' + (isTrain ? ICONS.train : String(stop._pin)) + "</div>",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    });
    var html = '<div class="stop-popup"><h3>' + stop.name + "</h3>";
    var meta = [];
    if (stopKm(stop) != null) meta.push("km " + stopKm(stop));
    if (stop.prohlidka_min) meta.push("prohlídka ~" + stop.prohlidka_min + " min");
    if (meta.length) html += '<p class="meta">' + meta.join(" · ") + "</p>";
    if (stop.popis) html += "<p>" + stop.popis + "</p>";
    if (stop.photo_spot) html += '<p class="photo-spot">' + ICONS.camera + " Super místo na fotku</p>";
    var fact = state.factsByStop && state.factsByStop[stop.id];
    if (fact) html += '<p class="stop-fact">' + ICONS.info + " " + fact + "</p>";
    html += "</div>";
    m.bindPopup(html);
    return m;
  }

  // segs (volitelné): úsekové vzdálenosti mezi zastávkami, segs[i] = úsek
  // mezi stops[i] a stops[i+1]; null = neukazovat (např. bez GPX).
  function renderStopsList(stops, segs) {
    var ol = el("stops-list");
    ol.innerHTML = "";
    stops.forEach(function (s, i) {
      var li = document.createElement("li");
      var pin = s._pin === "train"
        ? '<span class="stop-pin train">' + ICONS.train + "</span>"
        : '<span class="stop-pin num">' + s._pin + "</span>";
      var kmTxt = stopKm(s) != null ? ' <span class="km">km ' + stopKm(s) + "</span>" : "";
      var visit = s.prohlidka_min
        ? ' <span class="visit">· prohlídka ~' + s.prohlidka_min + " min</span>"
        : "";
      var spot = s.photo_spot ? ' <span class="photo-spot-badge" title="Super místo na fotku">' + ICONS.camera + "</span>" : "";
      var fact = state.factsByStop && state.factsByStop[s.id];
      var factHtml = fact ? '<div class="stop-fact">' + ICONS.info + " " + fact + "</div>" : "";
      li.innerHTML = pin +
        '<div class="stop-body"><div><span class="stop-name">' + s.name + "</span>" +
        spot + kmTxt + visit + "</div>" + (s.popis || "") + factHtml + "</div>";
      ol.appendChild(li);
      if (segs && segs[i]) {
        var seg = document.createElement("li");
        seg.className = "seg-row";
        seg.innerHTML = "<span>" + segs[i] + "</span>";
        ol.appendChild(seg);
      }
    });
  }

  function renderStats(stats) {
    var g = el("stats");
    g.innerHTML = "";
    stats.forEach(function (s) {
      var d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = '<div class="label">' + (s.icon || "") + s.label +
        '</div><div class="value">' + s.value +
        (s.sub ? "<small>" + s.sub + "</small>" : "") + "</div>";
      g.appendChild(d);
    });
  }

  // Lišta varianty trasy (výlet 2): info o zobrazené verzi + tlačítko přepnutí.
  function renderVariantNote(trip) {
    var box = el("variant-note");
    if (!trip.varianta_alt) { box.hidden = true; box.innerHTML = ""; return; }
    var v = trip.varianta_alt;
    box.hidden = false;
    box.innerHTML =
      "<span>" + (state.variantAlt ? v.info_alt : v.info) + "</span> " +
      '<button type="button" class="variant-btn">' +
      (state.variantAlt ? v.prepnout_zpet : v.prepnout) +
      "</button>";
    box.querySelector(".variant-btn").addEventListener("click", function () {
      state.variantAlt = !state.variantAlt;
      showTrip(trip);
    });
  }

  // ---------------------------------------------------------------- herní vrstva: UI

  // Foto-hledačka + králík: odškrtávací seznam, žádný upload — fotka žije
  // v roličce telefonu, tady jen „hotovo".
  // justToggledId: položka odškrtnutá právě teď dostane pop animaci
  // (bez toho by poskočily všechny hotové položky při každém rerenderu).
  function renderScavenger(trip, justToggledId) {
    var wrap = el("scavenger-wrap");
    var ul = el("scavenger-list");
    var items = trip.scavenger || [];
    if (!items.length && !trip.rabbit_hint) { wrap.hidden = true; return; }
    wrap.hidden = false;
    ul.innerHTML = "";
    var checks = tripChecks(trip.id);

    function addItem(id, icon, text, xp, isRabbit) {
      var li = document.createElement("li");
      li.className = "scav-item" + (checks[id] ? " done" : "") + (isRabbit ? " rabbit" : "");
      var pop = checks[id] && id === justToggledId ? " pop" : "";
      li.innerHTML =
        '<button type="button" class="scav-check" aria-pressed="' + !!checks[id] + '">' +
        '<span class="scav-icon">' + icon + "</span>" +
        '<span class="scav-text">' + text + '<span class="scav-xp">+' + xp + " XP</span></span>" +
        '<span class="scav-box' + pop + '">' + (checks[id] ? "✓" : "") + "</span></button>";
      li.querySelector("button").addEventListener("click", function () {
        if (checks[id]) delete checks[id];
        else checks[id] = true;
        afterProgressChange();
        renderScavenger(trip, checks[id] ? id : null);
        renderMissionState(trip);
      });
      ul.appendChild(li);
    }

    if (trip.rabbit_hint) addItem("rabbit", "🐇", trip.rabbit_hint, XP_RABBIT, true);
    items.forEach(function (it) { addItem(it.id, it.icon || "📷", it.text, XP_SCAVENGER, false); });
  }

  function renderMissionState(trip) {
    var sub = el("mission-subtitle");
    sub.hidden = !trip.mission_subtitle;
    if (trip.mission_subtitle) sub.textContent = trip.mission_subtitle;

    var box = el("mission-progress");
    var total = (trip.scavenger || []).length + (trip.rabbit_hint ? 1 : 0);
    if (!total) { box.hidden = true; return; }
    var checks = progress.checks[trip.id] || {};
    var done = (trip.scavenger || []).filter(function (it) { return checks[it.id]; }).length +
      (checks.rabbit ? 1 : 0);
    var m = progress.missions[trip.id];
    var complete = m && m.done;
    var pct = complete ? 100 : Math.round((done / total) * 100);
    box.hidden = false;
    box.className = complete ? "complete" : "";
    box.innerHTML =
      '<div class="mp-row"><span>' +
      (complete
        ? "Mise splněna ✓ bonus +" + (m.xp != null ? m.xp : trip.xp_value || 0) + " XP"
        : "Úkoly mise: " + done + " / " + total) +
      '</span></div><div class="mp-bar"><i style="width:' + pct + '%"></i></div>';
  }

  function showTrip(trip) {
    if (state.current !== trip.id) state.variantAlt = false; // přepnutí výletu → default varianta
    state.current = trip.id;
    clearTrip();
    el("sheet-content").scrollTop = 0;

    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.trip === trip.id ? "true" : "false");
    });

    // fakta k zastávkám téhle mise (na kartách, v popupech i v navigátoru)
    state.factsByStop = {};
    (trip.facts || []).forEach(function (f) { state.factsByStop[f.stop_id] = f.fact; });

    el("trip-title").textContent = trip.mission_title || trip.nazev;
    renderMissionState(trip);
    renderScavenger(trip);
    renderCaseButton(trip);
    applyCaseFocus(trip);

    // Mise s případem: přistání ROVNOU v zápletce/hře, žádný plánovací
    // mezikrok. Výjimky: uživatel si případ vědomě odložil kvůli mapě
    // (pill „Zpět k případu" je vidět) a uzavřený případ (fokus sheet
    // s „otevřít znovu" stačí, done obrazovku nevnucujeme).
    var landingCase = caseForTrip(trip.id);
    if (landingCase && !state.unfocus) {
      var lcProg = progress.cases[landingCase.id];
      var steppedOut = caseState.caseDef === landingCase && !el("case-return").hidden;
      var finished = lcProg && lcProg.finaleDone;
      if (!steppedOut && !finished && el("case-mode").hidden) openCase(landingCase);
    } else {
      el("case-return").hidden = true; // pill mimo misi případu nedává smysl
    }
    el("trip-desc").textContent = trip.popis;
    el("routes-note").textContent = trip.znacene_trasy
      ? "Značené trasy: " + trip.znacene_trasy
      : "";

    renderVariantNote(trip);

    var stops = state.stops
      .filter(function (s) {
        if (s.trip !== trip.id) return false;
        // zastávky jen pro plnou variantu (varianta: "plna") se v default verzi skryjí
        if (s.varianta === "plna" && !state.variantAlt) return false;
        return true;
      })
      .slice()
      .sort(function (a, b) {
        var ka = stopKm(a), kb = stopKm(b);
        if (ka == null && kb == null) return 0;
        if (ka == null) return 1;
        if (kb == null) return -1;
        return ka - kb;
      });

    // Číslování pinů: nádraží mají vlakovou ikonu, ostatní pořadové číslo.
    var pinNo = 0;
    stops.forEach(function (s) {
      s._pin = isStation(s) ? "train" : String(++pinNo);
    });

    stops.forEach(function (s) {
      state.tripLayers.addLayer(stopMarker(s));
      state.stopLatLngs.push(L.latLng(s.lat, s.lng));
    });
    renderStopsList(stops);


    var visitsMin = stops.reduce(function (a, s) { return a + (s.prohlidka_min || 0); }, 0);

    var gpxUrl = state.variantAlt && trip.varianta_alt ? trip.varianta_alt.gpx : trip.gpx;
    fetch(dataUrl(gpxUrl))
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (gpxText) {
        var pts = gpxText ? parseGpx(gpxText) : null;
        if (pts) renderRoute(trip, pts, stops, visitsMin, gpxText);
        else renderNoRoute(trip, stops, visitsMin);
      })
      .catch(function () { renderNoRoute(trip, stops, visitsMin); });
  }

  // fitBounds padding: na desktopu route nesmí zajet pod plovoucí panel
  // vpravo. animate: false — při přepnutí výletu chceme rovnou cílový výřez
  // (a animovaný zoom se v některých webview nedokončí spolehlivě).
  function fitOptions() {
    if (desktopMq.matches) {
      return { paddingTopLeft: [40, 40], paddingBottomRight: [456, 40], animate: false };
    }
    return { padding: [30, 30], animate: false };
  }

  function renderNoRoute(trip, stops, visitsMin) {
    el("gpx-missing").hidden = false;
    el("elevation-empty").hidden = false;
    el("difficulty-badge").hidden = true;
    el("shortened").hidden = true;
    renderStats([
      { icon: ICONS.clock, label: "Prohlídky", value: fmtTime(visitsMin) },
      { icon: ICONS.bike, label: "Trasa", value: "…", sub: "GPX čeká na vygenerování" },
    ]);
    if (stops.length) {
      map.fitBounds(
        L.latLngBounds(stops.map(function (s) { return [s.lat, s.lng]; })),
        fitOptions()
      );
    }
  }

  function renderRoute(trip, pts, stops, visitsMin, gpxText) {
    el("gpx-missing").hidden = true;
    el("elevation-empty").hidden = true;

    var line = toLineString(pts);
    var km = turf.length(line, { units: "kilometers" });
    var gain = elevationGain(pts);
    // snapshot pro auto odznaky (ukládá se při dokončení mise)
    state.lastStats[trip.id] = { km: Math.round(km * 10) / 10, gain: gain || 0 };

    // Model času: tempo dle mise (cyklo 11 km/h, pěší z dat) + ~1 min
    // na každých 10 m převýšení.
    var rideMin = (km / tripTempo(trip)) * 60 + (gain != null ? (gain / 10) * CLIMB_MIN_PER_10M : 0);
    var totalMin = rideMin + visitsMin;

    // Obtížnost: meter 1/2/3 (délka a převýšení po jednom bodu) + label.
    // Monochrome + žlutá, žádný semafor.
    var hardLen = km > HARD_KM;
    var hardGain = gain != null && gain > HARD_GAIN_M;
    var hard = hardLen || hardGain;
    var level = 1 + (hardLen ? 1 : 0) + (hardGain ? 1 : 0);
    var badge = el("difficulty-badge");
    badge.hidden = false;
    badge.className = hard ? "hard" : "easy";
    var meter = '<span class="meter">';
    for (var bi = 1; bi <= 3; bi++) meter += '<i class="' + (bi <= level ? "on" : "") + '"></i>';
    meter += "</span>";
    badge.innerHTML = meter +
      (hard ? (hardGain ? "Náročnější: převýšení" : "Náročnější: délka") : "Pohodová");

    var short = el("shortened");
    if (hard && trip.zkracena) {
      short.hidden = false;
      short.innerHTML = "<strong>Zkrácená varianta:</strong> " + trip.zkracena;
    } else if (trip.zkracena) {
      short.hidden = false;
      short.innerHTML = "<strong>Tip na zkrácení:</strong> " + trip.zkracena;
    } else {
      short.hidden = true;
    }

    renderStats([
      { icon: ICONS.bike, label: "Vzdálenost", value: km.toFixed(1) + " km" },
      { icon: ICONS.mountain, label: "Převýšení", value: gain != null ? gain + " m" : "…" },
      {
        icon: ICONS.clock,
        label: trip.cas_label || "Čistá jízda",
        value: fmtTime(rideMin),
        sub: "+ prohlídky, celkem " + fmtTime(totalMin),
      },
    ]);

    // Kilometrovník á 5 km (turf.along po trase z GPX)
    for (var d = KM_MARKER_STEP; d < km; d += KM_MARKER_STEP) {
      var p = turf.along(line, d, { units: "kilometers" });
      var c = p.geometry.coordinates;
      var kmMarker = L.marker([c[1], c[0]], {
        interactive: false,
        icon: L.divIcon({
          className: "km-marker",
          html: String(d),
          iconSize: [22, 16],
          iconAnchor: [11, 8],
        }),
      });
      state.tripLayers.addLayer(kmMarker);
      state.kmMarkers.push(kmMarker);
    }

    // úsekové vzdálenosti mezi zastávkami → seznam znovu i s mezikusy
    renderStopsList(stops, buildSegments(pts, stops, tripTempo(trip)));

    // Výškový profil — leaflet-elevation vykreslí trasu i graf;
    // tap/hover na profilu ukáže odpovídající bod na mapě.
    state.eleControl = L.control.elevation({
      theme: "wr-theme",
      detached: true,
      elevationDiv: "#elevation",
      height: 140,
      closeBtn: false,
      followMarker: false,
      autofitBounds: false,
      imperial: false,
      legend: false,
      summary: false,
      downloadLink: false,
      ruler: false,
      edgeScale: false,
      waypoints: false,
      wptIcons: false,
      almostOver: false,
      distanceMarkers: false,
      time: false,
      speed: false,
      slope: false,
      // hotline vypnout: default 'elevation' překreslí trasu výškovým
      // gradientem (zelená→červená semafor) a polyline zneviditelní.
      hotline: false,
      polyline: { color: "#FFC107", weight: 5, opacity: 1, lineCap: "round", lineJoin: "round" },
    });
    state.eleControl.on("eledata_added", function (e) {
      if (e && e.layer) state.eleLayer = e.layer;
    });
    state.eleControl.addTo(map);
    state.eleControl.load(gpxText);

    map.fitBounds(
      L.latLngBounds(pts.map(function (p) { return [p[0], p[1]]; })),
      fitOptions()
    );
    setTimeout(updateKmCollisions, 300);
  }

  // ------------------------------------------------ layout: sheet vs. panel

  // Jeden kód, dva režimy: < 900 px mobilní bottom sheet, >= 900 px mapa
  // full-bleed + plovoucí boční panel. Taby žijí na mobilu pod headerem,
  // na desktopu nahoře v panelu (à la přepínač dopravy na Mapy.com).
  var desktopMq = window.matchMedia("(min-width: 900px)");
  var sheet = el("sheet");
  var sheetHandle = el("sheet-handle");
  var sheetContent = el("sheet-content");

  function applyLayout() {
    var tabs = el("tabs");
    if (desktopMq.matches) {
      sheet.classList.remove("open");
      if (tabs.parentNode !== sheet) sheet.insertBefore(tabs, sheetContent);
    } else {
      var main = document.querySelector("main");
      if (tabs.parentNode === sheet) document.body.insertBefore(tabs, main);
    }
    // po přechodu přes breakpoint překreslit výlet (fitBounds s novým
    // paddingem — jinak trasa zůstane pod panelem / mimo výřez).
    // invalidateSize těsně před fitem: RO/resize eventy můžou laggovat
    // a fitBounds by počítal se starou velikostí mapy.
    if (state.current) {
      var trip = state.trips.find(function (t) { return t.id === state.current; });
      if (trip) {
        setTimeout(function () {
          map.invalidateSize();
          showTrip(trip);
        }, 60);
      }
    }
  }
  // matchMedia change event je v některých webview nespolehlivý —
  // hlídáme breakpoint i přes window resize.
  var lastDesktop = null;
  function checkLayout() {
    if (desktopMq.matches !== lastDesktop) {
      lastDesktop = desktopMq.matches;
      applyLayout();
    }
  }
  desktopMq.addEventListener("change", checkLayout);
  window.addEventListener("resize", checkLayout);
  setInterval(checkLayout, 500); // pojistka: v některých webview eventy laggují
  checkLayout();

  // Mobil: dvě snap pozice (peek / plná). Tap na handle přepíná, svislý swipe
  // na handle taky (threshold 24 px); tap do obsahu v peek stavu sheet otevře.
  var touchStartY = null;
  var swiped = false;

  sheetHandle.addEventListener("click", function () {
    if (swiped) { swiped = false; return; } // toggle už udělal swipe
    sheet.classList.toggle("open");
  });
  sheetHandle.addEventListener("touchstart", function (e) {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  sheetHandle.addEventListener("touchmove", function (e) {
    if (touchStartY == null) return;
    var dy = e.touches[0].clientY - touchStartY;
    if (dy < -24) { sheet.classList.add("open"); touchStartY = null; swiped = true; }
    else if (dy > 24) { sheet.classList.remove("open"); touchStartY = null; swiped = true; }
  }, { passive: true });
  sheetHandle.addEventListener("touchend", function () { touchStartY = null; }, { passive: true });

  sheetContent.addEventListener("click", function (e) {
    if (desktopMq.matches || sheet.classList.contains("open")) return;
    if (e.target.closest("button, a")) return; // tlačítka fungují normálně
    sheet.classList.add("open");
  });

  // ------------------------------------------------ herní vrstva: modaly

  document.querySelectorAll(".modal-close").forEach(function (btn) {
    btn.addEventListener("click", function () { el(btn.dataset.close).hidden = true; });
  });

  el("xp-button").addEventListener("click", function () {
    renderBadges();
    renderXp();
    el("badges-modal").hidden = false;
  });

  // Police odznaků: zamčené jsou vidět jako cíle, odemčené se rozsvítí.
  // Manuální odznak = self-check ťuknutím (ratchet zpět ťuknutím znovu).
  function renderBadges() {
    var grid = el("badges-grid");
    grid.innerHTML = "";
    // prázdný stav: při nule pobídnout, ne zet prázdnotou
    el("xp-nudge").hidden = computeXp() > 0 || Object.keys(progress.badges).length > 0;
    state.badges.forEach(function (b) {
      var unlocked = !!progress.badges[b.id];
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "badge-tile" + (unlocked ? " unlocked" : "");
      tile.innerHTML =
        '<span class="badge-icon">' + b.icon + "</span>" +
        '<span class="badge-name">' + b.name + "</span>" +
        '<span class="badge-desc">' + b.description + "</span>" +
        (b.condition.type === "manual" ? '<span class="badge-tap">' + (unlocked ? "splněno ✓" : "ťukni, až to splníš") + "</span>" : "");
      if (b.condition.type === "manual") {
        tile.addEventListener("click", function () {
          var awarding = !progress.badges[b.id];
          if (awarding) progress.badges[b.id] = true;
          else delete progress.badges[b.id];
          afterProgressChange();
          renderBadges();
          if (awarding) celebrate(b.icon, "Odznak: " + b.name, b.description);
        });
      } else {
        tile.disabled = true;
      }
      grid.appendChild(tile);
    });
  }

  // Záloha / obnova: JSON přes textarea (na iOS spolehlivější než stahování
  // souboru). Pojistka proti promazání localStorage.
  el("export-btn").addEventListener("click", function () {
    var data = JSON.stringify(progress);
    el("backup-area").value = data;
    var btn = el("export-btn");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(data).then(function () {
        btn.textContent = "Zkopírováno ✓";
        setTimeout(function () { btn.textContent = "Zkopírovat zálohu"; }, 1500);
      });
    }
  });

  el("import-btn").addEventListener("click", function () {
    var btn = el("import-btn");
    try {
      var p = JSON.parse(el("backup-area").value);
      if (!p || p.schema_version !== SCHEMA_VERSION) throw new Error("bad schema");
      var d = defaultProgress();
      Object.keys(d).forEach(function (k) { if (p[k] == null) p[k] = d[k]; });
      progress = p;
      afterProgressChange();
      renderBadges();
      refreshCurrentTrip();
      btn.textContent = "Načteno ✓";
    } catch (e) {
      btn.textContent = "Tohle není platná záloha";
    }
    setTimeout(function () { btn.textContent = "Načíst zálohu"; }, 2000);
  });

  el("reset-btn").addEventListener("click", function () {
    if (!window.confirm("Opravdu smazat celý postup? Odškrtnuté úkoly, XP i odznaky zmizí.")) return;
    progress = defaultProgress();
    saveProgress();
    renderXp();
    renderBadges();
    refreshCurrentTrip();
  });

  function refreshCurrentTrip() {
    if (!state.current) return;
    var trip = state.trips.find(function (t) { return t.id === state.current; });
    if (trip) { renderScavenger(trip); renderMissionState(trip); renderCaseButton(trip); }
  }

  // Táta-režim (dev): schovaný přepínač v nastavení, default vyplé
  var dadToggle = el("dad-mode-toggle");
  dadToggle.checked = dadMode();
  dadToggle.addEventListener("change", function () {
    try {
      if (dadToggle.checked) localStorage.setItem(DAD_MODE_KEY, "1");
      else localStorage.removeItem(DAD_MODE_KEY);
    } catch (e) { /* ok */ }
  });

  // ------------------------------------------------ story mode: case engine
  //
  // Volitelný detektivní režim nad misí: zápletka → radar (jen vzdálenost
  // z GPS, žádný kompas) → check-in (pásmo ~35 m + VŽDY ruční fallback)
  // → šifra (normalizovaná kontrola, hint po 2 pokusech, skip po 3)
  // → útržek příběhu + XP → finále (složení kódu) → rozuzlení + odznak.
  // Vše data-driven z data/cases.json, mise bez případu jedou beze změny.

  var DAD_MODE_KEY = "wr-vylety-mapa.dadmode";
  var caseState = {
    caseDef: null,  // aktivní případ (definice z cases.json)
    cpIndex: 0,     // index aktuální stopy
    view: null,     // intro | transit | task | reward | finale | done
    attempts: 0,    // špatné pokusy u aktuální šifry / finále
    watchId: null,  // geolocation watch
    simTimer: null, // táta-simulace
    lastDist: null,
  };

  function caseForTrip(tripId) {
    return (state.cases || []).find(function (c) { return c.mission_ref === tripId; });
  }

  function caseProg(caseId) {
    if (!progress.cases[caseId]) progress.cases[caseId] = { solved: {}, finaleDone: false };
    if (!progress.cases[caseId].solved) progress.cases[caseId].solved = {};
    return progress.cases[caseId];
  }

  // Kid-friendly normalizace odpovědí: malá písmena, bez diakritiky,
  // bez mezer a interpunkce.
  function normAnswer(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function answerMatches(task, given) {
    var g = normAnswer(given);
    if (!g) return false;
    if (normAnswer(task.answer) === g) return true;
    return (task.answer_alt || []).some(function (a) { return normAnswer(a) === g; });
  }

  function dadMode() {
    try { return localStorage.getItem(DAD_MODE_KEY) === "1"; } catch (e) { return false; }
  }

  // Soustředěný režim: mise s případem schová plánovací chrome (taby, logo,
  // tagline, trvalé statistiky) — hra nemá vypadat jako plánovač. Statistiky
  // jsou na vyžádání přes „Info o trase", návrat k výběru misí přes
  // „Všechny mise". Mise bez případu = plánovač beze změny.
  function applyCaseFocus(trip) {
    var focused = !!caseForTrip(trip.id) && !state.unfocus;
    document.body.classList.toggle("case-focus", focused);
    document.body.classList.remove("stats-open");
  }

  function renderCaseButton(trip) {
    var btn = el("case-btn");
    var c = caseForTrip(trip.id);
    if (!c) { btn.hidden = true; return; }
    var cp = progress.cases[c.id];
    btn.hidden = false;
    if (cp && cp.finaleDone) btn.textContent = "Případ uzavřen ✓ (otevřít znovu)";
    else if (cp && Object.keys(cp.solved || {}).length) btn.textContent = "Pokračovat v případu";
    else btn.textContent = "Zahájit případ: " + c.intro.title;
  }

  function openCase(c) {
    caseState.caseDef = c;
    var cp = caseProg(c.id);
    var next = (c.checkpoints || []).findIndex(function (k) { return !cp.solved[k.id] || !cp.solved[k.id].done; });
    if (cp.finaleDone) { caseState.view = "done"; caseState.cpIndex = c.checkpoints.length - 1; }
    else if (next === -1) { caseState.view = "finale"; caseState.cpIndex = c.checkpoints.length - 1; }
    else if (next === 0) { caseState.view = "intro"; caseState.cpIndex = 0; }
    else { caseState.view = "transit"; caseState.cpIndex = next; }
    caseState.attempts = 0;
    el("case-return").hidden = true;
    el("case-mode").hidden = false;
    renderCase();
  }

  function closeCase(finished) {
    stopRadar();
    el("case-mode").hidden = true;
    // rozehraný případ: plovoucí návrat, mapa je jen pomocník
    el("case-return").hidden = !!finished || !caseState.caseDef ||
      (progress.cases[caseState.caseDef.id] || {}).finaleDone;
  }

  el("case-close").addEventListener("click", function () { closeCase(false); });
  el("case-return").addEventListener("click", function () {
    if (caseState.caseDef) openCase(caseState.caseDef);
  });
  el("case-btn").addEventListener("click", function () {
    var c = caseForTrip(state.current);
    if (c) openCase(c);
  });

  el("focus-back").addEventListener("click", function () {
    state.unfocus = true; // zpátky k výběru misí (chrome se vrátí)
    var trip = state.trips.find(function (t) { return t.id === state.current; });
    if (trip) applyCaseFocus(trip);
  });

  el("route-info-btn").addEventListener("click", function () {
    document.body.classList.toggle("stats-open");
  });

  // ---- radar (jen vzdálenost, bez kompasu)

  function stopRadar() {
    if (caseState.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(caseState.watchId);
    }
    caseState.watchId = null;
    if (caseState.simTimer) { clearInterval(caseState.simTimer); caseState.simTimer = null; }
  }

  function startRadar(cp) {
    stopRadar();
    caseState.lastDist = null;
    if (!navigator.geolocation) {
      setRadarStatus("GPS tu není. Použij „Jsem tady i bez GPS“.");
      return;
    }
    caseState.watchId = navigator.geolocation.watchPosition(
      function (pos) {
        var d = haversineKm([pos.coords.latitude, pos.coords.longitude], [cp.lat, cp.lng]) * 1000;
        updateRadar(d, cp);
      },
      function () {
        setRadarStatus("GPS mlčí (nepovolená nebo bez signálu). Použij „Jsem tady i bez GPS“.");
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  function setRadarStatus(text) {
    var s = el("radar-status");
    if (s) s.textContent = text;
  }

  function updateRadar(distM, cp) {
    caseState.lastDist = distM;
    var numEl = el("radar-dist");
    var frame = el("radar-frame");
    var goBtn = el("case-checkin");
    if (!numEl) return;
    numEl.textContent = distM >= 1000 ? (distM / 1000).toFixed(1) + " km" : Math.round(distM) + " m";
    var threshold = cp.threshold_m || 35;
    var inZone = distM <= threshold;
    frame.classList.toggle("zone", inZone);
    // puls zrychluje s blížením (2 s daleko → 0.4 s u cíle)
    var dur = Math.max(0.4, Math.min(2, distM / 100));
    frame.style.animationDuration = dur + "s";
    goBtn.disabled = !inZone;
    setRadarStatus(inZone ? "Jsi na místě. Stopa je na dosah." : "Přibliž se k místu, pásmo je " + threshold + " m.");
  }

  // Táta-režim: simulace příchodu bez chození (ladění engine od stolu).
  // Odpočet je řízený časem, ne počtem tiků — throttling timerů ve webview
  // zpomalí jen překreslování, ne dobu příchodu (~3 s).
  function simulateArrival(cp) {
    if (caseState.simTimer) clearInterval(caseState.simTimer);
    var start = caseState.lastDist != null ? Math.max(caseState.lastDist, 120) : 250;
    var t0 = Date.now();
    caseState.simTimer = setInterval(function () {
      var t = (Date.now() - t0) / 1000;
      var d = Math.max(8, start * Math.pow(0.2, t / 1.2));
      updateRadar(d, cp);
      if (d <= 8) { clearInterval(caseState.simTimer); caseState.simTimer = null; }
    }, 120);
  }

  // ---- vykreslení obrazovek případu

  function renderCase() {
    var c = caseState.caseDef;
    if (!c) return;
    var box = el("case-view");
    var cp = c.checkpoints[caseState.cpIndex];
    var prog = caseProg(c.id);
    var total = c.checkpoints.length;
    stopRadar();

    if (caseState.view === "intro") {
      box.innerHTML =
        '<div class="micro-label">Nový případ</div>' +
        '<h2 class="case-title">' + c.intro.title + "</h2>" +
        '<p class="case-story">' + c.intro.story + "</p>" +
        '<button type="button" class="case-cta" id="case-go">Vydat se po stopě</button>';
      el("case-go").addEventListener("click", function () {
        caseState.view = "transit";
        renderCase();
      });

    } else if (caseState.view === "transit") {
      box.innerHTML =
        '<div class="micro-label">Stopa ' + (caseState.cpIndex + 1) + " z " + total + "</div>" +
        '<p class="case-story">' + cp.transit_hint + "</p>" +
        '<div id="radar-frame"><div id="radar-dist">…</div><div class="radar-sub">k místu</div></div>' +
        '<p class="note" id="radar-status">Hledám signál…</p>' +
        '<button type="button" class="case-cta" id="case-checkin" disabled>Jsem na místě</button>' +
        (dadMode() ? '<button type="button" class="ghost-btn case-sim" id="case-sim">Simulovat příchod (táta-režim)</button>' : "") +
        '<div class="case-links">' +
        '<button type="button" class="case-link" id="case-manual">Jsem tady i bez GPS</button>' +
        '<button type="button" class="case-link" id="case-showmap">Zobrazit mapu</button>' +
        "</div>";
      function checkin() {
        stopRadar();
        caseState.view = "task";
        caseState.attempts = 0;
        renderCase();
      }
      el("case-checkin").addEventListener("click", checkin);
      el("case-manual").addEventListener("click", checkin);
      el("case-showmap").addEventListener("click", function () { closeCase(false); });
      if (dadMode()) el("case-sim").addEventListener("click", function () { simulateArrival(cp); });
      startRadar(cp);

    } else if (caseState.view === "task") {
      box.innerHTML =
        '<div class="micro-label">Šifra ' + (caseState.cpIndex + 1) + " z " + total + "</div>" +
        '<p class="case-story">' + cp.task.prompt + "</p>" +
        (cp.task.image ? '<img class="case-img" src="' + cp.task.image + '" alt="">' : "") +
        '<input type="text" id="case-answer" autocomplete="off" autocapitalize="off" placeholder="Tvoje odpověď">' +
        '<p class="note case-wrong" id="case-feedback" hidden>Tudy ne. Zkus to znovu.</p>' +
        '<div class="case-hint" id="case-hint" hidden><strong>Nápověda:</strong> ' + cp.task.hint + "</div>" +
        '<button type="button" class="case-cta" id="case-submit">Odpovědět</button>' +
        '<div class="case-links"><button type="button" class="case-link" id="case-skip" hidden>Přeskočit úkol (bez XP)</button></div>';
      function solveCp(skipped) {
        var prog2 = caseProg(c.id);
        prog2.solved[cp.id] = { done: true, skipped: !!skipped };
        afterProgressChange();
        caseState.view = "reward";
        renderCase();
      }
      el("case-submit").addEventListener("click", function () {
        if (answerMatches(cp.task, el("case-answer").value)) { solveCp(false); return; }
        caseState.attempts++;
        el("case-feedback").hidden = false;
        if (caseState.attempts >= 2 && cp.task.hint) el("case-hint").hidden = false;
        if (caseState.attempts >= 3) el("case-skip").hidden = false;
      });
      el("case-skip").addEventListener("click", function () { solveCp(true); });

    } else if (caseState.view === "reward") {
      var wasSkipped = prog.solved[cp.id] && prog.solved[cp.id].skipped;
      var last = caseState.cpIndex >= total - 1;
      box.innerHTML =
        '<div class="micro-label">Útržek příběhu</div>' +
        '<div class="case-fragment">' + cp.reward.fragment + "</div>" +
        '<p class="case-xp">' + (wasSkipped ? "Bez XP (přeskočeno), ale stopa drží." : "+" + (cp.reward.xp || 0) + " XP") + "</p>" +
        '<button type="button" class="case-cta" id="case-next">' +
        (last ? "Ke složení klíče" : "Sledovat další stopu") + "</button>";
      el("case-next").addEventListener("click", function () {
        if (last) { caseState.view = "finale"; }
        else { caseState.cpIndex++; caseState.view = "transit"; }
        caseState.attempts = 0;
        renderCase();
      });

    } else if (caseState.view === "finale") {
      box.innerHTML =
        '<div class="micro-label">Složení klíče</div>' +
        '<p class="case-story">' + c.finale.assembly_prompt + "</p>" +
        '<div class="case-fragments-recap">' +
        c.checkpoints.map(function (k) { return '<div class="case-fragment small">' + k.reward.fragment + "</div>"; }).join("") +
        "</div>" +
        '<input type="text" id="case-code" autocomplete="off" autocapitalize="off" placeholder="Kód">' +
        '<p class="note case-wrong" id="case-feedback" hidden>Klíč nesedí. Podívej se na útržky ještě jednou.</p>' +
        '<button type="button" class="case-cta" id="case-code-submit">Zkusit kód</button>' +
        '<div class="case-links"><button type="button" class="case-link" id="case-reveal" hidden>Odhalit rozuzlení</button></div>';
      function finish() {
        caseProg(c.id).finaleDone = true;
        afterProgressChange();
        caseState.view = "done";
        renderCase();
      }
      el("case-code-submit").addEventListener("click", function () {
        if (normAnswer(el("case-code").value) === normAnswer(c.finale.code)) { finish(); return; }
        caseState.attempts++;
        el("case-feedback").hidden = false;
        if (caseState.attempts >= 3) el("case-reveal").hidden = false;
      });
      el("case-reveal").addEventListener("click", finish);

    } else if (caseState.view === "done") {
      box.innerHTML =
        '<div class="micro-label">Případ uzavřen</div>' +
        '<h2 class="case-title">' + c.intro.title + "</h2>" +
        '<p class="case-story">' + c.finale.resolution + "</p>" +
        '<button type="button" class="case-cta" id="case-finish">Zavřít případ</button>';
      el("case-finish").addEventListener("click", function () {
        closeCase(true);
        renderCaseButton(state.trips.find(function (t) { return t.id === state.current; }) || {});
      });
    }
  }

  // finále → odznak z dat (badge_id), reuse existující police a oslavy
  function awardCaseBadges() {
    (state.cases || []).forEach(function (c) {
      var b = c.finale && c.finale.badge_id &&
        state.badges.find(function (x) { return x.id === c.finale.badge_id; });
      if (!b) return;
      var cp = progress.cases[c.id];
      if (cp && cp.finaleDone && !progress.badges[b.id] && b.condition.type !== "auto") {
        progress.badges[b.id] = true;
        celebrate(b.icon, "Odznak: " + b.name, b.description);
      }
    });
  }

  // ------------------------------------------------ herní vrstva: onboarding

  var ONBOARD_KEY = "wr-vylety-mapa.onboarded";

  function showOnboarding() {
    var steps = el("onboard-steps");
    steps.innerHTML =
      "<li>" + ICONS.mapFold + "<div><strong>Vyber misi</strong><span>Výpravy za technickými památkami.</span></div></li>" +
      "<li>" + ICONS.bike + "<div><strong>Šlápni do pedálů</strong><span>Veď tátu od zastávky k zastávce.</span></div></li>" +
      "<li>" + ICONS.trophy + "<div><strong>Sbírej úkoly, XP a odznaky</strong><span>Foto-hledačka, králík a police trofejí.</span></div></li>";
    el("onboarding").hidden = false;
  }

  el("onboard-go").addEventListener("click", function () {
    el("onboarding").hidden = true;
    try { localStorage.setItem(ONBOARD_KEY, "1"); } catch (e) { /* ok */ }
  });

  el("show-onboarding").addEventListener("click", function () {
    el("badges-modal").hidden = true;
    showOnboarding();
  });

  // Navigátor (samostatné velké „kam teď") byl zrušen — vstup do případu
  // s radarem ho nahrazuje. Případný postup v progress.nav je inertní.

  // ---------------------------------------------------------------- start

  Promise.all([
    fetch(dataUrl("data/trips.json")).then(function (r) { return r.json(); }),
    fetch(dataUrl("data/stops.json")).then(function (r) { return r.json(); }),
    fetch(dataUrl("data/badges.json")).then(function (r) { return r.json(); }),
    // případy jsou volitelné: chybějící/rozbitý cases.json = žádný story
    // mode, appka jede dál (čistá odebratelnost)
    fetch(dataUrl("data/cases.json"))
      .then(function (r) { return r.ok ? r.json() : { cases: [] }; })
      .catch(function () { return { cases: [] }; }),
  ])
    .then(function (res) {
      state.trips = res[0].trips;
      state.stops = res[1];
      state.badges = res[2].badges || [];
      state.cases = res[3].cases || [];

      renderXp();

      var tabs = el("tabs");
      state.trips.forEach(function (trip) {
        var b = document.createElement("button");
        b.setAttribute("role", "tab");
        b.dataset.trip = trip.id;
        b.innerHTML = trip.tab + '<span class="sub">' + trip.tab_sub + "</span>";
        b.addEventListener("click", function () {
          sheet.classList.remove("open"); // nový výlet: zpátky na mapu (peek)
          state.unfocus = false; // výběr mise s případem → soustředěný režim
          showTrip(trip);
        });
        tabs.appendChild(b);
      });

      showTrip(state.trips[0]);

      // úplně první spuštění: onboarding přes rozmazanou mapu (jen jednou)
      var onboarded = null;
      try { onboarded = localStorage.getItem(ONBOARD_KEY); } catch (e) { /* ok */ }
      if (!onboarded) showOnboarding();
    })
    .catch(function (err) {
      console.error(err);
      el("trip-title").textContent = "Chyba načtení dat";
      el("trip-desc").textContent = String(err);
    });
})();
