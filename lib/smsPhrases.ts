import type { LanguageCode } from "./languages";

// The wording of the text message, written by hand for each language instead of machine-translated.
// These few phrases decide what a farmer does ("irrigate now"), and a text has a hard length limit,
// so they are short, fixed, and meant to be reviewed by a native speaker.
//
// DRAFT: the non-English wording below has not been checked by native speakers yet. Please have
// someone fluent (ideally with farming knowledge) review each language before real farmers get it.
//
// {date}, {n} and {k} are filled in when the message is built.

export type SmsPhraseKey =
  | "greeting"
  | "headerOne"
  | "headerMany"
  | "allOk"
  | "more"
  | "veryDry"
  | "dry"
  | "cropsFading"
  | "hotSpell"
  | "needsLook"
  | "irrigateNow"
  | "irrigate3d"
  | "holdOff"
  | "monitor"
  | "inspect"
  | "actNow"
  | "check3d";

interface Phrases extends Record<SmsPhraseKey, string> {
  months: readonly string[]; // short month names, January first
}

export const SMS_PHRASES: Record<LanguageCode, Phrases> = {
  en: {
    greeting: "Good morning!",
    headerOne: "FarmOS {date}: 1 field needs action.",
    headerMany: "FarmOS {date}: {n} fields need action.",
    allOk: "FarmOS {date}: all fields OK. No action.",
    more: "+{k} more.",
    veryDry: "very dry",
    dry: "dry",
    cropsFading: "crops fading",
    hotSpell: "hot spell",
    needsLook: "needs a look",
    irrigateNow: "IRRIGATE NOW",
    irrigate3d: "IRRIGATE 3D",
    holdOff: "HOLD OFF",
    monitor: "MONITOR",
    inspect: "INSPECT",
    actNow: "ACT NOW",
    check3d: "CHECK 3D",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
  sw: {
    greeting: "Habari za asubuhi!",
    headerOne: "FarmOS {date}: shamba 1 linahitaji hatua.",
    headerMany: "FarmOS {date}: mashamba {n} yanahitaji hatua.",
    allOk: "FarmOS {date}: mashamba yote sawa. Hakuna hatua.",
    more: "+{k} zaidi.",
    veryDry: "kavu sana",
    dry: "kavu",
    cropsFading: "mazao yanafifia",
    hotSpell: "joto kali",
    needsLook: "linahitaji ukaguzi",
    irrigateNow: "MWAGILIA SASA",
    irrigate3d: "MWAGILIA NDANI YA SIKU 3",
    holdOff: "SUBIRI",
    monitor: "FUATILIA",
    inspect: "KAGUA",
    actNow: "CHUKUA HATUA SASA",
    check3d: "KAGUA NDANI YA SIKU 3",
    months: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ago", "Sep", "Okt", "Nov", "Des"],
  },
  fr: {
    greeting: "Bonjour !",
    headerOne: "FarmOS {date} : 1 champ demande une action.",
    headerMany: "FarmOS {date} : {n} champs demandent une action.",
    allOk: "FarmOS {date} : tous les champs OK. Aucune action.",
    more: "+{k} de plus.",
    veryDry: "très sec",
    dry: "sec",
    cropsFading: "cultures en déclin",
    hotSpell: "forte chaleur",
    needsLook: "à vérifier",
    irrigateNow: "IRRIGUER MAINTENANT",
    irrigate3d: "IRRIGUER SOUS 3J",
    holdOff: "ATTENDRE",
    monitor: "SURVEILLER",
    inspect: "INSPECTER",
    actNow: "AGIR MAINTENANT",
    check3d: "VERIFIER SOUS 3J",
    months: ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"],
  },
  es: {
    greeting: "¡Buenos días!",
    headerOne: "FarmOS {date}: 1 campo necesita acción.",
    headerMany: "FarmOS {date}: {n} campos necesitan acción.",
    allOk: "FarmOS {date}: todos los campos bien. Sin acción.",
    more: "+{k} más.",
    veryDry: "muy seco",
    dry: "seco",
    cropsFading: "cultivos decayendo",
    hotSpell: "calor intenso",
    needsLook: "revisar",
    irrigateNow: "REGAR YA",
    irrigate3d: "REGAR EN 3 DIAS",
    holdOff: "ESPERAR",
    monitor: "VIGILAR",
    inspect: "INSPECCIONAR",
    actNow: "ACTUAR YA",
    check3d: "REVISAR EN 3 DIAS",
    months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  },
  pt: {
    greeting: "Bom dia!",
    headerOne: "FarmOS {date}: 1 campo precisa de ação.",
    headerMany: "FarmOS {date}: {n} campos precisam de ação.",
    allOk: "FarmOS {date}: todos os campos OK. Sem ação.",
    more: "+{k} mais.",
    veryDry: "muito seco",
    dry: "seco",
    cropsFading: "cultivos enfraquecendo",
    hotSpell: "calor forte",
    needsLook: "verificar",
    irrigateNow: "IRRIGAR AGORA",
    irrigate3d: "IRRIGAR EM 3 DIAS",
    holdOff: "AGUARDAR",
    monitor: "MONITORAR",
    inspect: "INSPECIONAR",
    actNow: "AGIR AGORA",
    check3d: "VERIFICAR EM 3 DIAS",
    months: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  },
  hi: {
    greeting: "सुप्रभात!",
    headerOne: "FarmOS {date}: 1 खेत को कार्रवाई चाहिए।",
    headerMany: "FarmOS {date}: {n} खेतों को कार्रवाई चाहिए।",
    allOk: "FarmOS {date}: सभी खेत ठीक हैं। कोई कार्रवाई नहीं।",
    more: "+{k} और।",
    veryDry: "बहुत सूखा",
    dry: "सूखा",
    cropsFading: "फसल कमज़ोर हो रही",
    hotSpell: "तेज़ गर्मी",
    needsLook: "जाँच करें",
    irrigateNow: "अभी सिंचाई करें",
    irrigate3d: "3 दिन में सिंचाई करें",
    holdOff: "रुकें",
    monitor: "निगरानी रखें",
    inspect: "निरीक्षण करें",
    actNow: "अभी कदम उठाएं",
    check3d: "3 दिन में जाँचें",
    months: ["जन", "फर", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सित", "अक्टू", "नव", "दिस"],
  },
};

export function smsPhrase(language: LanguageCode, key: SmsPhraseKey, params: Record<string, string | number> = {}): string {
  return SMS_PHRASES[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function smsMonth(language: LanguageCode, monthIndex: number): string {
  return SMS_PHRASES[language].months[monthIndex];
}
