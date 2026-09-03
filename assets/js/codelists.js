// Ported from Ryhti/Core/Query/BuildingCodeLists.swift.
// Codes come from the real koodistot.suomi.fi registry, not guessed — keep the
// raw code + URI shape identical to the iOS app so both hit the same API rows.

import { locale } from "./i18n.js?v=2026-09-03a";

const PURPOSE_BASE = "http://uri.suomi.fi/codelist/rytj/avoin_rakennusluokitus/code/";
const ACTION_BASE = "http://uri.suomi.fi/codelist/rytj/Rakentamistoimenpide/code/";
const STATUS_BASE = "http://uri.suomi.fi/codelist/rytj/rakkohteen-toimenpiteen-tila/code/";

/**
 * Names come from the koodistot.suomi.fi registry in both languages, so the
 * Swedish column is the official term rather than a translation of the Finnish.
 * Three deviate from the registry's Swedish on purpose:
 *
 *  * Purpose 02 and action 01 follow the shortened Finnish labels this app
 *    already uses instead of the registry's longer official ones.
 *  * "Stadsbildsåtgärd" and "Ändringsarbete jämförbart med nybyggande" correct
 *    a dropped s and a disagreeing adjective in the registry's own Swedish.
 *
 * shortName is this app's, not the registry's: the official names wrap to three
 * lines and squeeze the bars into a narrow column.
 */
const PURPOSES = [
  { code: "01", fi: { name: "Vapaa-ajan asuinrakennus", shortName: "Vapaa-ajan asunto" },
    sv: { name: "Fritidsbostadshus", shortName: "Fritidsbostad" } },
  { code: "02", fi: { name: "Toimisto-, tuotanto- tai yhdyskuntatekniikan rakennus", shortName: "Toimisto / tuotanto" },
    sv: { name: "Kontors-, produktions- eller samhällsteknisk byggnad", shortName: "Kontor / produktion" } },
  { code: "03", fi: { name: "Talousrakennus", shortName: "Talousrakennus" },
    sv: { name: "Ekonomibyggnad", shortName: "Ekonomibyggnad" } },
  { code: "04", fi: { name: "Saunarakennus", shortName: "Saunarakennus" },
    sv: { name: "Bastubyggnad", shortName: "Bastubyggnad" } },
  { code: "05", fi: { name: "Pientalo", shortName: "Pientalo" },
    sv: { name: "Småhus", shortName: "Småhus" } },
  { code: "06", fi: { name: "Kerrostalo", shortName: "Kerrostalo" },
    sv: { name: "Flervåningshus", shortName: "Flervåningshus" } },
  { code: "07", fi: { name: "Julkinen rakennus", shortName: "Julkinen rakennus" },
    sv: { name: "Offentlig byggnad", shortName: "Offentlig byggnad" } },
];

const ACTION_TYPES = [
  { code: "01", fi: "Uudisrakennus", sv: "Nybyggnad" },
  { code: "02", fi: "Laajennus", sv: "Utvidgning" },
  { code: "03", fi: "Uudelleenrakentamiseen verrattava muutostyö", sv: "Ändringsarbete jämförbart med nybyggande" },
  { code: "04", fi: "Muu muutostyö", sv: "Annat ändringsarbete" },
  { code: "05", fi: "Purkaminen", sv: "Rivning" },
  { code: "06", fi: "Rakennuksen osittainen purkaminen", sv: "Delvis rivning av en byggnad" },
  { code: "07", fi: "Kaupunkikuvatoimenpide", sv: "Stadsbildsåtgärd" },
  { code: "08", fi: "Maisemaa muuttava toimenpide", sv: "Åtgärd som ändrar landskapet" },
  { code: "09", fi: "Rakennuksen tai rakennelman päivitys", sv: "Uppdatering av byggnad eller konstruktion" },
];

const STATUSES = [
  { code: "1", fi: "Suunniteltu", sv: "Planerad" },
  { code: "2", fi: "Aloitettu", sv: "Inledd" },
  { code: "3", fi: "Keskeytetty", sv: "Avbruten" },
  { code: "4", fi: "Rauennut", sv: "Beslut om att avstå från åtgärden" },
  { code: "5", fi: "Valmistunut", sv: "Färdig" },
];

/**
 * The three lists resolved to the page's language at load, so every consumer
 * keeps reading a flat `{ code, name }` and none of them has to know that a
 * second language exists.
 *
 * The real purpose code list has exactly these 7 values — coarser than one
 * might expect.
 */
export const BUILDING_PURPOSES = PURPOSES.map((p) => ({ code: p.code, ...p[locale] }));

export const CONSTRUCTION_ACTION_TYPES = ACTION_TYPES.map((a) => ({ code: a.code, name: a[locale] }));

export const CONSTRUCTION_STATUSES = STATUSES.map((s) => ({ code: s.code, name: s[locale] }));

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
