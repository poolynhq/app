/**
 * Curated metros for waitlist typeahead (substring match, case-insensitive).
 * Users can still submit a custom string if their area is not listed.
 */
export const METRO_AREAS: readonly string[] = [
  "Adelaide, Australia",
  "Amsterdam, Netherlands",
  "Atlanta, Georgia, USA",
  "Auckland, New Zealand",
  "Austin, Texas, USA",
  "Barcelona, Spain",
  "Berlin, Germany",
  "Boston, Massachusetts, USA",
  "Brisbane, Australia",
  "Brussels, Belgium",
  "Calgary, Alberta, Canada",
  "Canberra, Australia",
  "Chicago, Illinois, USA",
  "Copenhagen, Denmark",
  "Dallas, Texas, USA",
  "Denver, Colorado, USA",
  "Detroit, Michigan, USA",
  "Dublin, Ireland",
  "Edinburgh, United Kingdom",
  "Edmonton, Alberta, Canada",
  "Frankfurt, Germany",
  "Gold Coast, Australia",
  "Hamburg, Germany",
  "Helsinki, Finland",
  "Hong Kong SAR",
  "Houston, Texas, USA",
  "London, United Kingdom",
  "Los Angeles, California, USA",
  "Madrid, Spain",
  "Manchester, United Kingdom",
  "Melbourne, Australia",
  "Miami, Florida, USA",
  "Milan, Italy",
  "Minneapolis, Minnesota, USA",
  "Montreal, Quebec, Canada",
  "Munich, Germany",
  "Nashville, Tennessee, USA",
  "New York, New York, USA",
  "Oslo, Norway",
  "Ottawa, Ontario, Canada",
  "Paris, France",
  "Perth, Australia",
  "Philadelphia, Pennsylvania, USA",
  "Phoenix, Arizona, USA",
  "Portland, Oregon, USA",
  "Raleigh, North Carolina, USA",
  "San Diego, California, USA",
  "San Francisco, California, USA",
  "San Jose, California, USA",
  "Seattle, Washington, USA",
  "Singapore",
  "Stockholm, Sweden",
  "Sydney, Australia",
  "Tokyo, Japan",
  "Toronto, Ontario, Canada",
  "Vancouver, British Columbia, Canada",
  "Vienna, Austria",
  "Warsaw, Poland",
  "Washington, D.C., USA",
  "Wellington, New Zealand",
  "Zurich, Switzerland",
].sort((a, b) => a.localeCompare(b));

const MAX_SUGGESTIONS = 8;

export function filterMetroAreas(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: string[] = [];
  for (const m of METRO_AREAS) {
    if (m.toLowerCase().includes(q)) {
      matches.push(m);
      if (matches.length >= MAX_SUGGESTIONS) break;
    }
  }
  return matches;
}
