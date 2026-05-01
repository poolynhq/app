/**
 * Curated metros for waitlist typeahead.
 * Search ranks: city-name prefix > any-word prefix > anywhere substring.
 * Users can still submit a custom string if their area is not listed.
 */
export const METRO_AREAS: readonly string[] = [
  "Adelaide, South Australia, Australia",
  "Amsterdam, Netherlands",
  "Atlanta, Georgia, USA",
  "Auckland, New Zealand",
  "Austin, Texas, USA",
  "Baltimore, Maryland, USA",
  "Bangkok, Thailand",
  "Barcelona, Spain",
  "Beijing, China",
  "Berlin, Germany",
  "Boston, Massachusetts, USA",
  "Brisbane, Queensland, Australia",
  "Brussels, Belgium",
  "Calgary, Alberta, Canada",
  "Canberra, ACT, Australia",
  "Cape Town, South Africa",
  "Charlotte, North Carolina, USA",
  "Chicago, Illinois, USA",
  "Columbus, Ohio, USA",
  "Copenhagen, Denmark",
  "Dallas, Texas, USA",
  "Denver, Colorado, USA",
  "Detroit, Michigan, USA",
  "Dubai, UAE",
  "Dublin, Ireland",
  "Edinburgh, United Kingdom",
  "Edmonton, Alberta, Canada",
  "Frankfurt, Germany",
  "Gold Coast, Queensland, Australia",
  "Hamburg, Germany",
  "Helsinki, Finland",
  "Hong Kong SAR",
  "Houston, Texas, USA",
  "Indianapolis, Indiana, USA",
  "Jacksonville, Florida, USA",
  "Jakarta, Indonesia",
  "Johannesburg, South Africa",
  "Kuala Lumpur, Malaysia",
  "Las Vegas, Nevada, USA",
  "London, United Kingdom",
  "Los Angeles, California, USA",
  "Louisville, Kentucky, USA",
  "Madrid, Spain",
  "Manchester, United Kingdom",
  "Melbourne, Victoria, Australia",
  "Melbourne, Florida, USA",
  "Miami, Florida, USA",
  "Milan, Italy",
  "Milwaukee, Wisconsin, USA",
  "Minneapolis, Minnesota, USA",
  "Montreal, Quebec, Canada",
  "Mumbai, India",
  "Munich, Germany",
  "Nashville, Tennessee, USA",
  "New Orleans, Louisiana, USA",
  "New York, New York, USA",
  "Oslo, Norway",
  "Ottawa, Ontario, Canada",
  "Paris, France",
  "Perth, Western Australia, Australia",
  "Philadelphia, Pennsylvania, USA",
  "Phoenix, Arizona, USA",
  "Portland, Oregon, USA",
  "Raleigh, North Carolina, USA",
  "Sacramento, California, USA",
  "San Antonio, Texas, USA",
  "San Diego, California, USA",
  "San Francisco, California, USA",
  "San Jose, California, USA",
  "Seattle, Washington, USA",
  "Singapore",
  "Stockholm, Sweden",
  "Sydney, New South Wales, Australia",
  "Taipei, Taiwan",
  "Tokyo, Japan",
  "Toronto, Ontario, Canada",
  "Vancouver, British Columbia, Canada",
  "Vienna, Austria",
  "Warsaw, Poland",
  "Washington, D.C., USA",
  "Wellington, New Zealand",
  "Zurich, Switzerland",
].sort((a, b) => a.localeCompare(b));

const MAX_SUGGESTIONS = 7;

/**
 * Returns up to MAX_SUGGESTIONS matches, ranked:
 *  1. City name starts with query
 *  2. Any word/token in the string starts with query
 *  3. Query found anywhere in the string
 */
export function filterMetroAreas(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const cityStart: string[] = [];
  const wordStart: string[] = [];
  const anywhere: string[] = [];

  for (const m of METRO_AREAS) {
    const lower = m.toLowerCase();
    const city = lower.split(",")[0].trim();

    if (city.startsWith(q)) {
      cityStart.push(m);
    } else if (lower.split(/[\s,]+/).some((w) => w.length > 1 && w.startsWith(q))) {
      wordStart.push(m);
    } else if (lower.includes(q)) {
      anywhere.push(m);
    }
  }

  return [...cityStart, ...wordStart, ...anywhere].slice(0, MAX_SUGGESTIONS);
}
