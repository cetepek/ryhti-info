// Ported from Ryhti/Core/Query/BuildingCodeLists.swift.
// Codes come from the real koodistot.suomi.fi registry, not guessed — keep the
// raw code + URI shape identical to the iOS app so both hit the same API rows.

const PURPOSE_BASE = "http://uri.suomi.fi/codelist/rytj/avoin_rakennusluokitus/code/";
const ACTION_BASE = "http://uri.suomi.fi/codelist/rytj/Rakentamistoimenpide/code/";
const STATUS_BASE = "http://uri.suomi.fi/codelist/rytj/rakkohteen-toimenpiteen-tila/code/";

/** The real code list has exactly these 7 values — coarser than one might expect. */
export const BUILDING_PURPOSES = [
  { code: "01", name: "Vapaa-ajan asuinrakennus", shortName: "Vapaa-ajan asunto" },
  { code: "02", name: "Toimisto-, tuotanto- tai yhdyskuntatekniikan rakennus", shortName: "Toimisto / tuotanto" },
  { code: "03", name: "Talousrakennus", shortName: "Talousrakennus" },
  { code: "04", name: "Saunarakennus", shortName: "Saunarakennus" },
  { code: "05", name: "Pientalo", shortName: "Pientalo" },
  { code: "06", name: "Kerrostalo", shortName: "Kerrostalo" },
  { code: "07", name: "Julkinen rakennus", shortName: "Julkinen rakennus" },
];

export const CONSTRUCTION_ACTION_TYPES = [
  { code: "01", name: "Uudisrakennus" },
  { code: "02", name: "Laajennus" },
  { code: "03", name: "Uudelleenrakentamiseen verrattava muutostyö" },
  { code: "04", name: "Muu muutostyö" },
  { code: "05", name: "Purkaminen" },
  { code: "06", name: "Rakennuksen osittainen purkaminen" },
  { code: "07", name: "Kaupunkikuvatoimenpide" },
  { code: "08", name: "Maisemaa muuttava toimenpide" },
  { code: "09", name: "Rakennuksen tai rakennelman päivitys" },
];

export const CONSTRUCTION_STATUSES = [
  { code: "1", name: "Suunniteltu" },
  { code: "2", name: "Aloitettu" },
  { code: "3", name: "Keskeytetty" },
  { code: "4", name: "Rauennut" },
  { code: "5", name: "Valmistunut" },
];

export const purposeURI = (code) => `${PURPOSE_BASE}${code}`;
export const actionTypeURI = (code) => `${ACTION_BASE}${code}`;
export const statusURI = (code) => `${STATUS_BASE}${code}`;

/** Parses a full code-list URI back to its trailing code. Returns null when absent. */
export function codeFromURI(uri) {
  if (typeof uri !== "string" || uri.length === 0) return null;
  const parts = uri.split("/");
  return parts[parts.length - 1] || null;
}

export function purposeName(code) {
  return BUILDING_PURPOSES.find((p) => p.code === code)?.name ?? null;
}
