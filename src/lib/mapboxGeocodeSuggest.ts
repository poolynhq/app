/**
 * Mapbox + Nominatim forward geocode suggestions (places, cities, addresses).
 * Used by ad-hoc trip flows; keep in sync with onboarding location search behavior.
 */

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

export type GeoSuggestion = {
  label: string;
  lat: number;
  lng: number;
  countryCode?: string;
};

async function mapboxV6Suggest(
  query: string,
  proximity: string,
  signal: AbortSignal,
  countryFilter?: string
): Promise<GeoSuggestion[]> {
  if (!MAPBOX_TOKEN) return [];
  const countryParam = countryFilter
    ? `&country=${encodeURIComponent(countryFilter.toUpperCase())}`
    : "";
  const proximityParam = proximity !== "ip" ? `&proximity=${proximity}` : "";
  const res = await fetch(
    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(
      query.trim()
    )}&access_token=${MAPBOX_TOKEN}&types=address,place,locality,region&limit=8${proximityParam}${countryParam}`,
    { signal }
  );
  const data = (await res.json()) as {
    features?: {
      geometry: { coordinates: [number, number] };
      properties: {
        full_address?: string;
        name?: string;
        context?: { country?: { country_code?: string } };
      };
    }[];
  };
  return (data.features ?? []).map((f) => ({
    label:
      f.properties.full_address ??
      f.properties.name ??
      `${f.geometry.coordinates[1].toFixed(5)}, ${f.geometry.coordinates[0].toFixed(5)}`,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    countryCode: f.properties.context?.country?.country_code?.toLowerCase(),
  }));
}

async function nominatimSuggest(
  query: string,
  _proximity: string,
  signal: AbortSignal,
  countryFilter?: string
): Promise<GeoSuggestion[]> {
  /** Unbounded so city names (e.g. Sacramento, Perth) resolve even far from the user. */
  const countryParam = countryFilter ? `&countrycodes=${countryFilter}` : "";
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query.trim()
    )}&format=json&limit=6&accept-language=en${viewboxParam}${countryParam}`,
    { signal, headers: { "Accept-Language": "en" } }
  );
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return data.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

/**
 * City names, suburbs, street addresses. Merges Mapbox v6 with Nominatim fallback.
 */
export async function geocodeSuggestPlaces(
  query: string,
  options: {
    proximity?: string;
    signal?: AbortSignal;
    countryCode?: string;
    minLength?: number;
  } = {}
): Promise<GeoSuggestion[]> {
  const min = options.minLength ?? 2;
  if (query.trim().length < min) return [];
  const proximity = options.proximity ?? "ip";
  const signal = options.signal ?? new AbortController().signal;
  const countryLower = options.countryCode?.toLowerCase();
  const countryUpper = countryLower?.toUpperCase();

  const [v6Settled, nomSettled] = await Promise.allSettled([
    mapboxV6Suggest(query, proximity, signal, countryUpper),
    nominatimSuggest(query, proximity, signal, countryLower),
  ]);
  const v6List = v6Settled.status === "fulfilled" ? v6Settled.value : [];
  const nomList = nomSettled.status === "fulfilled" ? nomSettled.value : [];
  const seen = new Set<string>();
  const merged: GeoSuggestion[] = [];
  for (const r of [...v6List, ...nomList]) {
    if (!seen.has(r.label)) {
      seen.add(r.label);
      merged.push(r);
    }
    if (merged.length >= 10) break;
  }
  return merged;
}
