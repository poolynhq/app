/**
 * Personal / free email hostnames blocked for the public waitlist and enterprise flows.
 * Keep in sync with `consumer_email_domains()` in
 * `supabase/migrations/0053_waitlist_work_email_and_consumer_domains_expand.sql`.
 */
export const CONSUMER_EMAIL_DOMAINS = [
  "163.com",
  "aol.com",
  "duck.com",
  "fastmail.com",
  "gmail.com",
  "googlemail.com",
  "gmx.com",
  "hey.com",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.com.au",
  "icloud.com",
  "live.co.uk",
  "live.com",
  "live.com.au",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "naver.com",
  "outlook.co.uk",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "rocketmail.com",
  "tutanota.com",
  "tutamail.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "yahoo.com",
  "yahoo.com.au",
  "ymail.com",
  "yandex.com",
  "zoho.com",
] as const;

const DOMAIN_SET = new Set<string>(CONSUMER_EMAIL_DOMAINS);

export const WAITLIST_WORK_EMAIL_MESSAGE =
  "Please use your work email. Personal addresses (Gmail, Outlook, iCloud, etc.) are not accepted.";

export function emailDomainFromAddress(email: string): string | null {
  const t = email.trim().toLowerCase();
  const parts = t.split("@");
  if (parts.length < 2) return null;
  const d = parts[parts.length - 1]?.trim();
  return d || null;
}

/** @returns null if the address uses a non-consumer domain, otherwise a user-facing error string */
export function waitlistWorkEmailRejectReason(email: string): string | null {
  const d = emailDomainFromAddress(email);
  if (!d) return "Please enter a valid email address.";
  if (DOMAIN_SET.has(d)) return WAITLIST_WORK_EMAIL_MESSAGE;
  return null;
}
