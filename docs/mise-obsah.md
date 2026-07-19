# Herní obsah cyklovýletů — draft v1

Obsah pro tři mise + odznaky. Struktura odpovídá datovému modelu v zadání pro CC
(mission_title, scavenger, rabbit_hint, facts, badges). Placeholdery v appce se
nahradí tímhle.

Fakta označená ⚠️ ověřit před nasazením — nejsem si jistý místní vazbou.

---

## Mise 01 — Výtah pro lodě

**Výlet:** Zdymadlo Hořín (Polabí, rovina)
**mission_subtitle:** „Najdi místo, kde se řeka umí zvednout o dům výš."
**xp_value:** 100

**Foto-hledačka (scavenger):**
- Loď, hausbót nebo cokoli, co pluje po vodě
- Něco úplně žlutého (barva Bílého králíka)
- Vinná réva nebo vinice (jsme ve víně)
- Vodní pták — labuť, volavka nebo aspoň drzá kachna
- Táta, jak zkoumá, jak zdymadlo funguje

**rabbit_hint:** Vyfoť králíka na zábradlí plavební komory — jako by čekal, až ho voda vyveze nahoru.

**Fakta (facts) u zastávek:**
- *Zdymadlo Hořín:* Zdymadlo je vlastně výtah pro lodě. Napustí se vodou a loď se v komoře zvedne o víc než 8 metrů, aby obeplula mělký kus řeky. Tohle je z roku 1905 a je pořád funkční.
- *Soutok Labe a Vltavy (Mělník):* U Mělníka se Vltava vlévá do Labe. Jenže Vltava je delší a nese víc vody — takže by se řeka správně měla jmenovat dál Vltava. Jméno si ale nechalo Labe.
- *Mělník:* Mělník je jedno z nejstarších vinařských měst u nás, réva se tu pěstuje přes tisíc let.

**Foto-spoty (photo_spots):** vyhlídka na soutok u mělnického zámku; hráz/komora zdymadla.

---

## Mise 02 — Tajemství staré páry

**Výlet:** Pivovar Lobeč (Kokořínsko)
**mission_subtitle:** „Pivovar, co roztáčela pára, a skály jako pokličky na hrnec."
**xp_value:** zkrácená varianta 150 · plná varianta 300

**Foto-hledačka (scavenger):**
- Skála, co vypadá jako poklička
- Turistická značka — a zapamatuj si její barvu
- Něco úplně žlutého
- Něco starého a železného (páka, kolo, stroj)
- Táta, jak funí do kopce

**rabbit_hint:** Vyfoť králíka na sudu v pivovaru nebo nahoře na Pokličce — ať má výhled.

**Fakta (facts) u zastávek:**
- *Pivovar Lobeč:* Tenhle pivovar je starý přes 500 let a kdysi ho poháněl parní stroj — proto „parostrojní". Od jara 2026 je tu nová výstava, jak pára celý pivovar roztáčela.
- *Pokličky (Kokořínský důl, plná varianta):* Pokličky jsou pískovcové skály. Tvrdší „čepička" nahoře chrání měkčí kámen pod sebou, takže vznikne hřib, co vypadá jako poklička na hrnec.
- *Hrad Kokořín (plná varianta):* Gotický hrad ze 14. století. Dlouho byl polorozpadlý a romantici 19. století si o něm vymýšleli pověsti o loupežnících.
- *Muzeum Eduarda Štorcha (Lobeč):* V Lobči je muzeum Eduarda Štorcha, který napsal Lovce mamutů. ⚠️ ověřit místní vazbu a existenci muzea, než to pustíš do appky.

**Foto-spoty (photo_spots):** Pokličky; nádvoří pivovaru.

---

## Mise 03 — Lov hvězd

**Výlet:** Hvězdárna Ondřejov (Ladův kraj)
**mission_subtitle:** „Vyšlápni si k největšímu oku Česka."
**xp_value:** 200

**Foto-hledačka (scavenger):**
- Kopule hvězdárny
- Kočka (poklona Mikešovi z Hrusic) — jakákoli se počítá
- Něco úplně žlutého
- Dalekohled, anténa nebo něco, co kouká do nebe
- Táta u cíle, celý zničený po výšlapu

**rabbit_hint:** Vyfoť králíka u kopule hvězdárny, jak se dívá do vesmíru.

**Fakta (facts) u zastávek:**
- *Hvězdárna Ondřejov:* Je tu největší dalekohled v Česku — jeho zrcadlo měří 2 metry. Secesní kopule navrhl architekt Josef Fanta, ten samý, co postavil pražské Hlavní nádraží.
- *Hrusice:* V Hrusicích se narodil malíř Josef Lada. A odtud pochází i kocour Mikeš, který uměl mluvit. (Památník Lady je teď zavřený kvůli opravě, takže vsí jen projedeme.)

**Foto-spoty (photo_spots):** kopule hvězdárny; náves v Hrusicích.

---

## Odznaky (badges.json)

Automatické se udělují z dat, manuální na vlastní ťuk (self-check, jako u kvízu
„hrajeme v obýváku" — bez kontroly).

**Automatické (condition = auto):**
- **První šlápnutí** — dokonči první misi.
- **Horský kozel** — nasbírej 500 m převýšení celkem.
- **Tři mise, tři razítka** — dokonči všechny tři mise.
- **Sběratel králíků** — vyfoť králíka na všech třech misích.

**Manuální (condition = manual, self-check):**
- **Přeživší deště** — jela jsem, i když pršelo.
- **Zmrzlinová královna** — dala jsem si cestou zmrzlinu.
- **Navigátorka** — dovedla jsem nás do cíle v navigátor režimu.
- **Píchačka** — přežila jsem první píchlou duši.
- **Bez fňukání** — celá mise beze slova „kdy už tam budeme".

**XP za odznak (volitelné):** klidně 50 XP za automatický, 25 za manuální —
ať se sbírání odznaků promítne do skóre. Nebo nech skóre čistě na misích.

---

## Poznámky k obsahu
- Tón držím hravý, ale ne dětinský — dvanáctiletá pozná lacinou snahu.
- Hledačky mají vždy jednu „něco žlutého" položku → drží WR motiv napříč misemi.
- „Táta jak trpí/funí/je zničený" je záměrně v každé misi — je to vtip, co ji baví,
  a zároveň tě to nutí jet s ní, ne za ní.
- Fakta jsou krátká na jednu vteřinu čtení — mají být střelivo, co vytáhne na tebe,
  ne přednáška.
- ⚠️ Před nasazením ověř: muzeum Eduarda Štorcha v Lobči (existence + vazba).
