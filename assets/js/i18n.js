// The page's language, and every string in the app that depends on it.
//
// /tilastot/ and /statistik/ are the same application, not two of them: they
// share every module in this directory and differ only in the prose baked into
// their HTML shells and in the table below. The page states its language once,
// in <html lang>, and everything here follows from that — so a fix to a chart
// or a query lands on both pages at once, which is the whole reason the strings
// were lifted out of the modules rather than copied alongside them.
//
// Parameterised strings are functions, not templates with placeholders. Word
// order differs between the two languages often enough that a
// "{count} lupaa"-style substitution would eventually produce Swedish with
// Finnish syntax; a function lets each language build its own sentence.

const SUPPORTED = ["fi", "sv"];

/** Falls back to Finnish for an unset or unknown lang, never to a blank page. */
export const locale = SUPPORTED.includes(document.documentElement.lang)
  ? document.documentElement.lang
  : "fi";

/**
 * Number formatting locale.
 *
 * sv-FI, not sv-SE: this is Finland-Swedish, and both Finnish conventions here
 * — space as the thousands separator, comma as the decimal mark — match what a
 * Swedish-speaking reader in Finland expects. sv-SE would agree on these two,
 * but naming the country keeps the intent explicit rather than accidental.
 */
export const numberLocale = locale === "sv" ? "sv-FI" : "fi-FI";

const STRINGS = {
  fi: {
    // Filters and the scope chips that echo them.
    allYears: "Kaikki vuodet",
    wholeCountry: "Koko Suomi",
    allPurposes: "Kaikki käyttötarkoitukset",

    // Loading and failure.
    loading: "Haetaan…",
    loadFailed: "Tietojen haku epäonnistui.",
    monthLoadFailed: "Kuukausivertailun haku epäonnistui.",
    rollingLoadFailed: "Kuukausisarjan haku epäonnistui.",
    networkFailed: "Yhteys rajapintaan epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.",
    apiStatus: (status) => `Rajapinta palautti virheen ${status}.`,
    apiUnreadable: "Rajapinnan vastausta ei voitu lukea.",
    wfsStatus: (status) => `WFS palautti virheen ${status}.`,
    wfsCountMissing: "WFS-vastauksesta ei löytynyt numberMatched-arvoa.",

    // Sample-derived figures always carry their sample size.
    medianSample: (n) => `Mediaani, otos n = ${n}`,
    noAreaInSample: "Ei kerrosalatietoja otoksessa",
    noStoreysInSample: "Ei kerroslukutietoja otoksessa",
    sampleSizeCell: (n) => `n = ${n}`,

    // Table headers.
    colYear: "Vuosi",
    colMonth: "Kuukausi",
    colPermits: "Lupia",
    colChange: "Muutos",
    colMedianArea: "Mediaanikerrosala",
    colSampleSize: "Otoskoko",
    colPurpose: "Käyttötarkoitus",
    colShare: "Osuus",
    colAction: "Toimenpide",
    colMunicipality: "Kunta",
    colTotalArea: "Kokonaiskerrosala",
    colAccuracy: "Tarkkuus",

    // Purpose card.
    purposeNote: "Lupien määrä rakennuksen pääkäyttötarkoituksen mukaan.",
    purposeUnclassified: (n) =>
      `Osuudet lasketaan luokitelluista luvista: ${n} luvalta pääkäyttötarkoitus puuttuu, ` +
      "eivätkä ne ole mukana jakaumassa.",
    classifiedPermits: "luokiteltua lupaa",

    // Municipality floor-area card, where the caption has to track which method ran.
    exactRowNote: (withArea, count) => `tarkka summa · kerrosala ilmoitettu ${withArea}/${count} luvassa`,
    estimateRowNote: (n) => `arvio, otos n = ${n}`,
    exactAccuracy: (n) => `tarkka (${n} kerrosalatietoa)`,
    estimateAccuracy: (n) => `arvio (otos n = ${n})`,
    muniAreaIncomplete:
      "Kuntakohtaisia lukuja ei voitu laskea, koska osa hausta epäonnistui. " +
      "Puutteellisia summia ei näytetä, koska ne jäisivät todellista pienemmiksi. Yritä uudelleen.",
    muniAreaExact:
      "Kaikkien rajaukseen osuvien lupien kerrosalat on laskettu yhteen. " +
      "Rivillä näkyy, kuinka monessa luvassa kerrosala on ilmoitettu.",
    muniAreaEstimate:
      "Arvio: otoksen keskimääräinen kerrosala × lupien määrä. Rajaus on niin laaja, ettei " +
      "tarkkaa summaa lasketa, joten luku voi poiketa todellisesta jopa kaksinkertaisesti " +
      "kumpaan suuntaan tahansa.",

    // Month comparison.
    noCompleteMonths: (year) =>
      `Vuodelta ${year} ei ole vielä yhtään päättynyttä kuukautta, joten vertailtavaa ei ole.`,
    partialSuffix: " (kesken)",
    monthNames: [
      "tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu",
      "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu",
    ],
    // Axis labels: twelve slots, no room for full month names.
    monthNamesShort: [
      "tammi", "helmi", "maalis", "huhti", "touko", "kesä",
      "heinä", "elo", "syys", "loka", "marras", "joulu",
    ],

    // Chart empty states and readouts.
    permitsUnit: "lupaa",
    chartTotal: "yhteensä",
    noDataForFilters: "Ei tietoja valituilla rajauksilla.",
    noAreaForFilters: "Ei kerrosalatietoja valituilla rajauksilla.",
    noComparableMonths: "Ei vertailukelpoisia kuukausia valituilla rajauksilla.",
    noComparableYears: "Ei vertailukelpoisia vuosia valituilla rajauksilla.",
    noValue: "ei tietoa",
    noValueCap: "Ei tietoja",
    noAreaForYear: "ei kerrosalatietoja",
    noComparisonYear: "ei vertailuvuotta",
    noComparisonYearCap: "Ei vertailuvuotta",

    // Chart descriptions for screen readers.
    ariaPermitsByYear: (from, to) => `Lupien määrä vuosittain, ${from}–${to}`,
    ariaPermitsByMonth: (from, to) => `Lupien määrä kuukausittain, ${from} – ${to}`,
    ariaMonthComparison: (current, previous) =>
      `Lupien määrä kuukausittain, ${current} verrattuna vuoteen ${previous}`,
    ariaPurposeSplit: (total, unit) => `Lupien jakauma käyttötarkoituksittain, yhteensä ${total} ${unit}`,
    ariaMedianAreaByYear: (from, to) => `Mediaanikerrosala vuosittain, ${from}–${to}`,
    ariaYearOverYear: (from, to) => `Lupamäärän muutos edellisvuoteen verrattuna, ${from}–${to}`,
    ariaYearDelta: (year, delta) => `${year}: ${delta} edellisvuoteen verrattuna`,
  },

  sv: {
    allYears: "Alla år",
    wholeCountry: "Hela Finland",
    allPurposes: "Alla användningsändamål",

    loading: "Hämtar…",
    loadFailed: "Hämtningen av uppgifterna misslyckades.",
    monthLoadFailed: "Hämtningen av månadsjämförelsen misslyckades.",
    rollingLoadFailed: "Hämtningen av månadsserien misslyckades.",
    networkFailed: "Anslutningen till gränssnittet misslyckades. Kontrollera nätverksanslutningen och försök igen.",
    apiStatus: (status) => `Gränssnittet returnerade felet ${status}.`,
    apiUnreadable: "Svaret från gränssnittet kunde inte läsas.",
    wfsStatus: (status) => `WFS returnerade felet ${status}.`,
    wfsCountMissing: "Värdet numberMatched hittades inte i WFS-svaret.",

    medianSample: (n) => `Median, urval n = ${n}`,
    noAreaInSample: "Inga uppgifter om våningsyta i urvalet",
    noStoreysInSample: "Inga uppgifter om våningsantal i urvalet",
    sampleSizeCell: (n) => `n = ${n}`,

    colYear: "År",
    colMonth: "Månad",
    colPermits: "Tillstånd",
    colChange: "Förändring",
    colMedianArea: "Median våningsyta",
    colSampleSize: "Urvalsstorlek",
    colPurpose: "Användningsändamål",
    colShare: "Andel",
    colAction: "Åtgärd",
    colMunicipality: "Kommun",
    colTotalArea: "Total våningsyta",
    colAccuracy: "Noggrannhet",

    purposeNote: "Antalet tillstånd enligt byggnadens huvudsakliga användningsändamål.",
    purposeUnclassified: (n) =>
      `Andelarna beräknas på de klassificerade tillstånden: ${n} tillstånd saknar huvudsakligt ` +
      "användningsändamål och ingår inte i fördelningen.",
    classifiedPermits: "klassificerade tillstånd",

    exactRowNote: (withArea, count) =>
      `exakt summa · våningsyta angiven för ${withArea}/${count} tillstånd`,
    estimateRowNote: (n) => `uppskattning, urval n = ${n}`,
    exactAccuracy: (n) => `exakt (${n} uppgifter om våningsyta)`,
    estimateAccuracy: (n) => `uppskattning (urval n = ${n})`,
    muniAreaIncomplete:
      "De kommunvisa talen kunde inte beräknas, eftersom en del av hämtningen misslyckades. " +
      "Ofullständiga summor visas inte, eftersom de skulle bli mindre än de verkliga. Försök igen.",
    muniAreaExact:
      "Våningsytorna för alla tillstånd som ingår i avgränsningen har summerats. " +
      "På raden syns för hur många tillstånd våningsytan är angiven.",
    muniAreaEstimate:
      "Uppskattning: urvalets genomsnittliga våningsyta × antalet tillstånd. Avgränsningen är " +
      "så bred att någon exakt summa inte beräknas, så talet kan avvika från det verkliga med " +
      "upp till det dubbla åt endera hållet.",

    noCompleteMonths: (year) =>
      `För år ${year} finns ännu ingen avslutad månad, så det finns inget att jämföra.`,
    partialSuffix: " (pågår)",
    monthNames: [
      "januari", "februari", "mars", "april", "maj", "juni",
      "juli", "augusti", "september", "oktober", "november", "december",
    ],
    monthNamesShort: [
      "jan", "feb", "mars", "apr", "maj", "juni",
      "juli", "aug", "sep", "okt", "nov", "dec",
    ],

    permitsUnit: "tillstånd",
    chartTotal: "totalt",
    noDataForFilters: "Inga uppgifter med de valda avgränsningarna.",
    noAreaForFilters: "Inga uppgifter om våningsyta med de valda avgränsningarna.",
    noComparableMonths: "Inga jämförbara månader med de valda avgränsningarna.",
    noComparableYears: "Inga jämförbara år med de valda avgränsningarna.",
    noValue: "ingen uppgift",
    noValueCap: "Inga uppgifter",
    noAreaForYear: "inga uppgifter om våningsyta",
    noComparisonYear: "inget jämförelseår",
    noComparisonYearCap: "Inget jämförelseår",

    ariaPermitsByYear: (from, to) => `Antalet tillstånd per år, ${from}–${to}`,
    ariaPermitsByMonth: (from, to) => `Antalet tillstånd per månad, ${from} – ${to}`,
    ariaMonthComparison: (current, previous) =>
      `Antalet tillstånd per månad, ${current} jämfört med år ${previous}`,
    ariaPurposeSplit: (total, unit) =>
      `Tillståndens fördelning enligt användningsändamål, totalt ${total} ${unit}`,
    ariaMedianAreaByYear: (from, to) => `Median våningsyta per år, ${from}–${to}`,
    ariaYearOverYear: (from, to) => `Förändring i antalet tillstånd jämfört med föregående år, ${from}–${to}`,
    ariaYearDelta: (year, delta) => `${year}: ${delta} jämfört med föregående år`,
  },
};

/** The active language's strings. Read as `t.colYear`, called as `t.medianSample(n)`. */
export const t = STRINGS[locale];
