/** First word of a display name for compact UI (wheel, celebrations). */
export function firstNameOnly(fullName: string | null | undefined): string {
  const s = (fullName || "").trim();
  if (!s) return "Member";
  const parts = s.split(/\s+/);
  return parts[0] || s;
}
