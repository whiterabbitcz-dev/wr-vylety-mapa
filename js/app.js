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

  // Flex/dvh layout (safe-area na iOS) se může dopočítat až po initu mapy —
  // dlaždice by se pak kreslily jen v pásu původní velikosti kontejneru.
  // Leaflet sleduje jen window resize, ne velikost kontejneru; ResizeObserver
  // pokryje každou změnu (dopočet flexu, rotace, schování lišty Safari).
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () { map.invalidateSize(); })
      .observe(document.getElementById("map"));
  } else {
    window.addEventListener("load", function () { map.invalidateSize(); });
  }

  var mapyLogoControl = null;

  function addMapyLogo() {
    var LogoControl = L.Control.extend({
      options: { position: "bottomleft" },
      onAdd: function () {
        var container = L.DomUtil.create("div", "mapy-logo");
        var link = L.DomUtil.create("a", "", container);
        link.setAttribute("href", "http://mapy.com/");
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener");
        link.innerHTML = '<img src="https://api.mapy.com/img/api/logo.svg" alt="Mapy.com">';
        L.DomEvent.disableClickPropagation(link);
        return container;
      },
    });
    mapyLogoControl = new LogoControl();
    map.addControl(mapyLogoControl);
  }

  function removeMapyLogo() {
    if (mapyLogoControl) { map.removeControl(mapyLogoControl); mapyLogoControl = null; }
  }

  // Řetěz podkladů: Mapy.com outdoor → CyclOSM → OSM. Když vrstva nevydá ani
  // jednu dlaždici a nasype chyby, přepneme na další v řadě.
  var baseLayers = [
    MAPY_KEY && {
      name: "mapy",
      make: function () {
        addMapyLogo();
        return L.tileLayer(
          "https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=" + MAPY_KEY,
          {
            minZoom: 0,
            maxZoom: 19,
            attribution:
              '<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>',
          }
        );
      },
      cleanup: removeMapyLogo,
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
    var W = 2; // půl-okno
    var smooth = eles.map(function (_, i) {
      var a = Math.max(0, i - W), b = Math.min(eles.length - 1, i + W);
      var s = 0;
      for (var j = a; j <= b; j++) s += eles[j];
      return s / (b - a + 1);
    });
    var gain = 0;
    for (var i = 1; i < smooth.length; i++) {
      var d = smooth[i] - smooth[i - 1];
      if (d > 0) gain += d;
    }
    return Math.round(gain);
  }

  // ---------------------------------------------------------------- stav výletu

  var state = {
    trips: [],
    stops: [],
    current: null,
    variantAlt: false, // u výletu s varianta_alt: false = default (zkrácená), true = plná
    eleControl: null,
    eleLayer: null,
    tripLayers: L.layerGroup().addTo(map),
  };

  // km pozice zastávky pro aktivní variantu (plná verze má vlastní km_plna)
  function stopKm(stop) {
    return state.variantAlt && stop.km_plna != null ? stop.km_plna : stop.km;
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
  };

  function isStation(stop) {
    return /žel\. stanice/.test(stop.name);
  }

  function clearTrip() {
    state.tripLayers.clearLayers();
    if (state.eleLayer) { map.removeLayer(state.eleLayer); state.eleLayer = null; }
    if (state.eleControl) { state.eleControl.remove(); state.eleControl = null; }
    el("elevation").innerHTML = "";
  }

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
    html += "</div>";
    m.bindPopup(html);
    return m;
  }

  function renderStopsList(stops) {
    var ol = el("stops-list");
    ol.innerHTML = "";
    stops.forEach(function (s) {
      var li = document.createElement("li");
      var pin = s._pin === "train"
        ? '<span class="stop-pin train">' + ICONS.train + "</span>"
        : '<span class="stop-pin num">' + s._pin + "</span>";
      var kmTxt = stopKm(s) != null ? ' <span class="km">km ' + stopKm(s) + "</span>" : "";
      var visit = s.prohlidka_min
        ? ' <span class="visit">· prohlídka ~' + s.prohlidka_min + " min</span>"
        : "";
      li.innerHTML = pin +
        '<div class="stop-body"><div><span class="stop-name">' + s.name + "</span>" +
        kmTxt + visit + "</div>" + (s.popis || "") + "</div>";
      ol.appendChild(li);
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

  function showTrip(trip) {
    if (state.current !== trip.id) state.variantAlt = false; // přepnutí výletu → default varianta
    state.current = trip.id;
    clearTrip();
    el("sheet-content").scrollTop = 0;

    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.trip === trip.id ? "true" : "false");
    });

    el("trip-title").textContent = trip.nazev;
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

    stops.forEach(function (s) { state.tripLayers.addLayer(stopMarker(s)); });
    renderStopsList(stops);

    var visitsMin = stops.reduce(function (a, s) { return a + (s.prohlidka_min || 0); }, 0);

    var gpxUrl = state.variantAlt && trip.varianta_alt ? trip.varianta_alt.gpx : trip.gpx;
    fetch(gpxUrl)
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (gpxText) {
        var pts = gpxText ? parseGpx(gpxText) : null;
        if (pts) renderRoute(trip, pts, stops, visitsMin, gpxText);
        else renderNoRoute(trip, stops, visitsMin);
      })
      .catch(function () { renderNoRoute(trip, stops, visitsMin); });
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
        { padding: [30, 30] }
      );
    }
  }

  function renderRoute(trip, pts, stops, visitsMin, gpxText) {
    el("gpx-missing").hidden = true;
    el("elevation-empty").hidden = true;

    var line = toLineString(pts);
    var km = turf.length(line, { units: "kilometers" });
    var gain = elevationGain(pts);

    // Model času: tempo 11 km/h na rovině + ~1 min na každých 10 m převýšení.
    var rideMin = (km / RIDE_SPEED_KMH) * 60 + (gain != null ? (gain / 10) * CLIMB_MIN_PER_10M : 0);
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
        label: "S prohlídkou",
        value: fmtTime(totalMin),
        sub: "jízda " + fmtTime(rideMin) + " (" + RIDE_SPEED_KMH + " km/h + kopce)",
      },
    ]);

    // Kilometrovník á 5 km (turf.along po trase z GPX)
    for (var d = KM_MARKER_STEP; d < km; d += KM_MARKER_STEP) {
      var p = turf.along(line, d, { units: "kilometers" });
      var c = p.geometry.coordinates;
      state.tripLayers.addLayer(
        L.marker([c[1], c[0]], {
          interactive: false,
          icon: L.divIcon({
            className: "km-marker",
            html: String(d),
            iconSize: [24, 18],
            iconAnchor: [12, 9],
          }),
        })
      );
    }

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
      { padding: [25, 25] }
    );
  }

  // ---------------------------------------------------------------- bottom sheet

  // Dvě snap pozice: peek (handle + titul + staty) a plná. Tap na handle
  // přepíná, svislý swipe na handle taky (threshold 24 px).
  var sheet = el("sheet");
  var sheetHandle = el("sheet-handle");
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

  // ---------------------------------------------------------------- start

  Promise.all([
    fetch("data/trips.json").then(function (r) { return r.json(); }),
    fetch("data/stops.json").then(function (r) { return r.json(); }),
  ])
    .then(function (res) {
      state.trips = res[0].trips;
      state.stops = res[1];

      var tabs = el("tabs");
      state.trips.forEach(function (trip) {
        var b = document.createElement("button");
        b.setAttribute("role", "tab");
        b.dataset.trip = trip.id;
        b.innerHTML = trip.tab + '<span class="sub">' + trip.tab_sub + "</span>";
        b.addEventListener("click", function () {
          sheet.classList.remove("open"); // nový výlet: zpátky na mapu (peek)
          showTrip(trip);
        });
        tabs.appendChild(b);
      });

      showTrip(state.trips[0]);
    })
    .catch(function (err) {
      console.error(err);
      el("trip-title").textContent = "Chyba načtení dat";
      el("trip-desc").textContent = String(err);
    });
})();
