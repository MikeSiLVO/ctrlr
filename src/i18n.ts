import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import ptBR from "./locales/pt-BR.json";
import ru from "./locales/ru.json";
import zhCN from "./locales/zh-CN.json";

/** Languages offered in the picker, each with a bundled translation. */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Espa\u00f1ol" },
  { code: "fr", label: "Fran\u00e7ais" },
  { code: "de", label: "Deutsch" },
  { code: "pt-BR", label: "Portugu\u00eas (BR)" },
  { code: "ru", label: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439" },
  { code: "zh-CN", label: "\u7b80\u4f53\u4e2d\u6587" },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      "pt-BR": { translation: ptBR },
      ru: { translation: ru },
      "zh-CN": { translation: zhCN },
    },
    // unlisted region tags match by language: en-US gets en, pt-PT gets pt-BR
    supportedLngs: LANGUAGES.map((l) => l.code),
    // default only applies when no entry matches; each entry carries en itself
    fallbackLng: {
      pt: ["pt-BR", "en"],
      zh: ["zh-CN", "en"],
      default: ["en"],
    },
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "ctrlr:language",
      caches: ["localStorage"],
    },
  });

export default i18n;
