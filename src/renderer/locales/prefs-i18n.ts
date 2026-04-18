import type { PrefsI18nBundle, UiLocale } from "../../shared/types.js";

let bundle: PrefsI18nBundle | null = null;

export function initPrefsI18n(next: PrefsI18nBundle): void {
  bundle = next;
}

function getBundle(): PrefsI18nBundle {
  if (!bundle) {
    throw new Error("initPrefsI18n() must run before using preferences i18n");
  }
  return bundle;
}

export function normalizeUiLocale(code: string | undefined | null): UiLocale {
  const b = getBundle();
  if (code && Object.prototype.hasOwnProperty.call(b, code)) {
    return code as UiLocale;
  }
  return "en";
}

export function prefT(locale: UiLocale, key: string): string {
  const b = getBundle();
  const table = b[locale];
  const s = table?.[key];
  if (s) return s;
  const en = b.en;
  return en[key] ?? key;
}

export function supportedUiLocales(): UiLocale[] {
  return Object.keys(getBundle()) as UiLocale[];
}
