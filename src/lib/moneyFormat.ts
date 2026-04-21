import { getLocales } from "expo-localization";

/**
 * Display-only formatting for integer cents. Not used for Stripe charge currency (that comes from
 * your Stripe account and PaymentIntent). We never infer money from IP; we use the device locale
 * from expo-localization (Region on iOS, locale list on Android; browser language tag on web).
 * When the user confirmed `billing_currency_user_code` on onboarding, that wins for the symbol.
 */

export type BillingCurrencyPrefs = {
  billing_currency_user_code?: string | null;
};

const REGION_TO_CURRENCY: Record<string, string> = {
  AU: "AUD",
  NZ: "NZD",
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  JP: "JPY",
  IN: "INR",
  SG: "SGD",
  HK: "HKD",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  BR: "BRL",
  MX: "MXN",
  KR: "KRW",
  CN: "CNY",
  TW: "TWD",
  AE: "AED",
  SA: "SAR",
  IL: "ILS",
  ZA: "ZAR",
};

const EUROZONE: Record<string, true> = {
  AT: true,
  BE: true,
  CY: true,
  EE: true,
  FI: true,
  FR: true,
  DE: true,
  GR: true,
  IE: true,
  IT: true,
  LV: true,
  LT: true,
  LU: true,
  MT: true,
  NL: true,
  PT: true,
  SK: true,
  SI: true,
  ES: true,
};

function inferCurrencyCodeForRegion(region: string | undefined | null): string {
  if (!region) return "USD";
  if (EUROZONE[region]) return "EUR";
  return REGION_TO_CURRENCY[region] ?? "USD";
}

function resolveLocaleTag(): string {
  try {
    const primary = getLocales()[0];
    if (primary?.languageTag) return primary.languageTag;
  } catch {
    /* fall through */
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * Prefer expo-localization: on iOS, `currencyCode` follows Settings → Language & Region → Region
 * (not the display language). On web, `currencyCode` is null; we use region from the language tag
 * or Intl fallback. Optional `billingPrefs` overrides currency for display after onboarding.
 */
export function resolveMoneyFormatLocaleAndCurrency(
  billingPrefs?: BillingCurrencyPrefs | null
): { locale: string; currency: string } {
  const locale = resolveLocaleTag();
  const preferred = billingPrefs?.billing_currency_user_code?.trim().toUpperCase();
  if (preferred && /^[A-Z]{3}$/.test(preferred)) {
    return { locale, currency: preferred };
  }
  try {
    const primary = getLocales()[0];
    if (primary) {
      const cc = primary.currencyCode?.trim();
      if (cc && /^[A-Z]{3}$/i.test(cc)) {
        return { locale, currency: cc.toUpperCase() };
      }
      const region = primary.regionCode ?? new Intl.Locale(locale).maximize().region;
      return { locale, currency: inferCurrencyCodeForRegion(region) };
    }
  } catch {
    /* fall through */
  }
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return { locale, currency: inferCurrencyCodeForRegion(region) };
  } catch {
    return { locale: "en-US", currency: "USD" };
  }
}

export function formatMoneyFromCents(
  cents: number | null | undefined,
  billingPrefs?: BillingCurrencyPrefs | null
): string {
  const n = (cents ?? 0) / 100;
  const { locale, currency } = resolveMoneyFormatLocaleAndCurrency(billingPrefs);
  return n.toLocaleString(locale, { style: "currency", currency });
}

/** @deprecated Use {@link formatMoneyFromCents} */
export const formatAudFromCents = formatMoneyFromCents;
