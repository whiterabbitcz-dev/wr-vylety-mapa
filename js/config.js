// Konfigurace klientských klíčů.
//
// MAPY_API_KEY = klíč Mapy.com REST API (dlaždice). Je client-side, proto MUSÍ být
// v developer konzoli Mapy.com omezený na doménu GitHub Pages (a případně localhost
// pro vývoj). Klíč patří do 1Password; sem se commitne až doménově omezený.
//
// Bez klíče (prázdný string) appka rovnou použije fallback CyclOSM/OSM.
// Pro rychlé lokální otestování jde klíč předat i v URL: ?mapykey=XXX
window.CONFIG = {
  MAPY_API_KEY: "JYiMylRNGVOOVSgSHRMnz8e3OnS2CjUm5U_QpvACV0M",
};
