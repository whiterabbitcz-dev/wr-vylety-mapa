// Seed waypointy pro ORS routing (DRIFT CONTROL).
//
// ORS sám o sobě nedrží značené cyklotrasy (č. 7, 0008, 0020…), proto každou
// trasu seedujeme HUSTÝMI průjezdními body. Postup (viz README):
//   1. `ORS_API_KEY=... node scripts/build_routes.mjs all`
//   2. Vygenerovanou trasu vizuálně přelož přes cyklovrstvu Mapy.com.
//   3. Kde router ujíždí z koridoru značené trasy, PŘIDEJ mezibod a přegeneruj.
//   4. Teprve pak GPX zmrazit (commit).
//
// Souřadnice ověřené geokódováním Mapy.com + Nominatim (2026-07-18, lokální
// session) — sedí se stops.json. Formát: [lon, lat].

export const trips = {
  // ── Výlet 1 — Zdymadlo Hořín (Polabí, rovina) ──────────────────────────
  // Okruh: Mělník žst → centrum → Vrázova vyhlídka (soutok) → most Josefa
  // Straky → zámecký park Hořín → zdymadlo → Vrbno → Zelčín (zoopark)
  // → Lužec n. Vlt. (lávka) → zpět stejným koridorem.
  // Koridor = Vltavská č. 7. Alternativa (neseedováno): Labská č. 2 /
  // EuroVelo 7 na Dolní Beřkovice → Horní Počaply.
  trip1: [
    [14.4924, 50.3530], // Mělník, žel. stanice
    [14.4741, 50.3505], // Mělník, centrum (pod zámkem)
    [14.4754, 50.3485], // Vrázova vyhlídka (soutok)
    [14.4685, 50.3518], // most Josefa Straky (přes Labe)
    [14.4627, 50.3462], // zámecký park Hořín
    [14.4686, 50.3409], // zdymadlo Hořín
    [14.4512, 50.3245], // Vrbno
    [14.4363, 50.3269], // Zelčín (zoopark)
    [14.3982, 50.3195], // Lužec nad Vltavou, lávka (otočný bod)
    [14.4363, 50.3269], // Zelčín (návrat)
    [14.4512, 50.3245], // Vrbno (návrat)
    [14.4686, 50.3409], // zdymadlo (návrat)
    [14.4627, 50.3462], // park (návrat)
    [14.4685, 50.3518], // most (návrat)
    [14.4924, 50.3530], // Mělník, žel. stanice
  ],

  // ── Výlet 2 — Pivovar Lobeč (Kokořínsko) ───────────────────────────────
  // DEFAULT = zkrácená verze (rodina + závislost na vlaku z Mšena 16:44):
  // Mšeno žst → náměstí → Skramouš → Lobeč (pivovar Lobeč 34 + muzeum
  // Štorcha, prohlídka 14:30) → zpět Mšeno žst.
  trip2: [
    [14.6408, 50.4358], // Mšeno, žel. stanice
    [14.6329, 50.4383], // Mšeno, náměstí Míru
    [14.6646, 50.4433], // Skramouš (drží koridor podél 273/železnice — bez něj ORS objíždí ~5 km smyčkou na SV)
    [14.6668, 50.4610], // Lobeč 34, parostrojní pivovar
    [14.6646, 50.4433], // Skramouš (návrat)
    [14.6329, 50.4383], // Mšeno (návrat)
    [14.6408, 50.4358], // Mšeno, žel. stanice
  ],

  // Plná verze („pro zdatné"): navíc okruh Kokořínským dolem — Romanov →
  // Pokličky → důl (cyklotrasa 0008) → hrad Kokořín a zpět, pak Lobeč.
  trip2_plna: [
    [14.6408, 50.4358], // Mšeno, žel. stanice
    [14.6329, 50.4383], // Mšeno, náměstí Míru
    [14.6275, 50.4492], // Romanov
    [14.5889, 50.4554], // Pokličky
    [14.5800, 50.4480], // Kokořínský důl (koridor trasy 0008)
    [14.5767, 50.4406], // hrad Kokořín
    [14.5800, 50.4480], // Kokořínský důl (návrat)
    [14.5889, 50.4554], // Pokličky (návrat)
    [14.6275, 50.4492], // Romanov (návrat)
    [14.6329, 50.4383], // Mšeno, náměstí
    [14.6646, 50.4433], // Skramouš
    [14.6668, 50.4610], // Lobeč 34, parostrojní pivovar
    [14.6646, 50.4433], // Skramouš (návrat)
    [14.6329, 50.4383], // Mšeno (návrat)
    [14.6408, 50.4358], // Mšeno, žel. stanice
  ],

  // ── Výlet 3 — Hvězdárna Ondřejov (Ladův kraj) ──────────────────────────
  // A→B s vlakem na obou koncích: Strančice žst → Mnichovice → Hrusice
  // (památník J. Lady, jižně od návsi) → Ondřejov ves → hvězdárna (stoupání)
  // → sjezd přes Turkovice → Senohraby žst. Koridor: 0020/0023/0025.
  // Volitelná odbočka Zvánovice/Voděradské bučiny se neseeduje (jen text v UI).
  trip3: [
    [14.6777, 49.9496], // Strančice, žel. stanice
    [14.7095, 49.9358], // Mnichovice, Masarykovo náměstí
    [14.7367, 49.9052], // Hrusice, památník J. Lady (do odvolání zavřen)
    [14.7830, 49.9047], // Ondřejov, ves (nám. 9. května)
    [14.7814, 49.9093], // hvězdárna Ondřejov (Fričova 298)
    [14.7830, 49.9047], // Ondřejov (návrat pod kopec)
    [14.7350, 49.9020], // koridor sjezdu přes Turkovice na Senohraby
    [14.7276, 49.8972], // Senohraby, žel. stanice
  ],
};
