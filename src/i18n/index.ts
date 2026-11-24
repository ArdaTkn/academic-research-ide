import { useCallback } from "react";
import { en, type TranslationKey } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { UiLocale } from "@/types/contracts";

export type { TranslationKey };

export const TRANSLATIONS: Record<UiLocale, Record<TranslationKey, string>> = {
  en,
  tr,
};

export function translate(
  locale: UiLocale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dict = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
  let text = dict[key] ?? TRANSLATIONS.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function formatLocalizedNumber(
  locale: UiLocale,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  const intlLocale = locale === "tr" ? "tr-TR" : "en-US";
  return new Intl.NumberFormat(intlLocale, options).format(value);
}

export function formatLocalizedDate(locale: UiLocale, isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return isoString;
  const intlLocale = locale === "tr" ? "tr-TR" : "en-US";
  return new Intl.DateTimeFormat(intlLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function useI18n() {
  const locale = useWorkspaceStore((s) => s.locale);
  const setLocale = useWorkspaceStore((s) => s.setLocale);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => formatLocalizedNumber(locale, value, options),
    [locale]
  );

  const formatDate = useCallback(
    (isoString: string) => formatLocalizedDate(locale, isoString),
    [locale]
  );

  return {
    locale,
    setLocale,
    t,
    formatNumber,
    formatDate,
  };
}
