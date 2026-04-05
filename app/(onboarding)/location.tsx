import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { MapPinPickerModal } from "@/components/maps/MapPinPickerModal";
import {
  upsertCommuteRouteToWork,
  upsertStraightLineCommuteRoute,
} from "@/lib/commuteRouteStorage";
import {
  buildStaticCommuteMapUrl,
  fetchRouteInfo,
  reverseGeocodeShort,
  type RouteInfo,
} from "@/lib/mapboxCommutePreview";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

interface GeoSuggestion {
  label: string;
  lat: number;
  lng: number;
  countryCode?: string; // ISO 3166-1 alpha-2 lowercase, e.g. "au"
}

// ── Mapbox v5 — address autocomplete (CORS-safe) ─────────────────────────────
// Also returns countryCode from the feature context so we can lock work
// searches to the same country as home.
async function mapboxAddressSuggest(
  query: string,
  proximity: string,
  signal: AbortSignal,
  countryFilter?: string // uppercase ISO, e.g. "AU"
): Promise<GeoSuggestion[]> {
  if (!MAPBOX_TOKEN) return [];
  const countryParam = countryFilter ? `&country=${countryFilter}` : "";
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      query.trim()
    )}.json?access_token=${MAPBOX_TOKEN}&types=address&autocomplete=true&limit=5&proximity=${proximity}${countryParam}`,
    { signal }
  );
  const data = (await res.json()) as {
    features?: {
      place_name: string;
      geometry: { coordinates: [number, number] };
      context?: { id: string; short_code?: string }[];
    }[];
  };
  return (data.features ?? []).map((f) => {
    const countryCtx = f.context?.find((c) => c.id.startsWith("country."));
    return {
      label: f.place_name,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      countryCode: countryCtx?.short_code?.toLowerCase(),
    };
  });
}

// ── Mapbox v6 — POI + address search (richer business/industrial coverage) ────
// Uses Foursquare-backed POI data — far better for companies, warehouses, etc.
async function mapboxV6Suggest(
  query: string,
  proximity: string,
  signal: AbortSignal,
  countryFilter?: string // uppercase ISO, e.g. "AU"
): Promise<GeoSuggestion[]> {
  if (!MAPBOX_TOKEN) return [];
  // v6 does not support type "poi" (only country, region, place, district, postcode, locality, neighborhood, street, address).
  // "poi,address" returns 422. Broader address + place coverage; Nominatim still supplies many POIs/landmarks.
  const countryParam = countryFilter
    ? `&country=${encodeURIComponent(countryFilter.toUpperCase())}`
    : "";
  const proximityParam = proximity !== "ip" ? `&proximity=${proximity}` : "";
  const res = await fetch(
    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(
      query.trim()
    )}&access_token=${MAPBOX_TOKEN}&types=address,place,locality&limit=6${proximityParam}${countryParam}`,
    { signal }
  );
  const data = (await res.json()) as {
    features?: {
      geometry: { coordinates: [number, number] };
      properties: {
        full_address?: string;
        context?: { country?: { country_code?: string } };
      };
    }[];
  };
  return (data.features ?? []).map((f) => ({
    label:
      f.properties.full_address ??
      `${f.geometry.coordinates[1].toFixed(5)}, ${f.geometry.coordinates[0].toFixed(5)}`,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    countryCode: f.properties.context?.country?.country_code?.toLowerCase(),
  }));
}

// ── Nominatim (OpenStreetMap) — fallback for institutions not in Mapbox ───────
async function nominatimPOISuggest(
  query: string,
  proximity: string,
  signal: AbortSignal,
  countryFilter?: string // lowercase ISO, e.g. "au"
): Promise<GeoSuggestion[]> {
  let viewboxParam = "";
  if (proximity !== "ip") {
    const parts = proximity.split(",");
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    const d = 1.5; // ~165 km — covers any realistic commute, strict (bounded=1)
    viewboxParam = `&viewbox=${lng - d},${lat + d},${lng + d},${lat - d}&bounded=1`;
  }
  const countryParam = countryFilter ? `&countrycodes=${countryFilter}` : "";
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query.trim()
    )}&format=json&limit=5&accept-language=en${viewboxParam}${countryParam}`,
    { signal, headers: { "Accept-Language": "en" } }
  );
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return data.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

// ── Combined geocode suggest ──────────────────────────────────────────────────
async function geocodeSuggest(
  query: string,
  options: {
    includePOI?: boolean;
    proximity?: string;
    signal?: AbortSignal;
    countryCode?: string; // lowercase ISO, e.g. "au"
  } = {}
): Promise<GeoSuggestion[]> {
  if (query.trim().length < 3) return [];
  const proximity = options.proximity ?? "ip";
  const signal = options.signal ?? new AbortController().signal;
  const countryLower = options.countryCode?.toLowerCase();
  const countryUpper = countryLower?.toUpperCase();

  if (options.includePOI) {
    // v6 is the primary source — it includes Foursquare business data so industrial
    // companies (warehouses, logistics firms, etc.) show up alongside street addresses.
    // Nominatim fills gaps for universities/hospitals/landmarks well-mapped on OSM.
    const [v6Settled, nominatimSettled] = await Promise.allSettled([
      mapboxV6Suggest(query, proximity, signal, countryUpper),
      nominatimPOISuggest(query, proximity, signal, countryLower),
    ]);
    const v6List = v6Settled.status === "fulfilled" ? v6Settled.value : [];
    const nominatimList = nominatimSettled.status === "fulfilled" ? nominatimSettled.value : [];
    const seen = new Set<string>();
    const merged: GeoSuggestion[] = [];
    for (const r of [...v6List, ...nominatimList]) {
      if (!seen.has(r.label)) {
        seen.add(r.label);
        merged.push(r);
      }
      if (merged.length === 8) break;
    }
    return merged;
  }
  return mapboxAddressSuggest(query, proximity, signal);
}

export default function LocationSetup() {
  const router = useRouter();
  const params = useLocalSearchParams<{ fromProfile?: string | string[] }>();
  const fromProfileRaw = Array.isArray(params.fromProfile) ? params.fromProfile[0] : params.fromProfile;
  const fromProfile = fromProfileRaw === "1" || fromProfileRaw === "true";
  const { profile, refreshProfile, session } = useAuth();
  const seededFromProfile = useRef(false);

  const [homeAddress, setHomeAddress] = useState("");
  const [workAddress, setWorkAddress] = useState("");
  const [workLabel, setWorkLabel] = useState("");
  const [homePin, setHomePin] = useState<{ lat: number; lng: number } | null>(null);
  const [workPin, setWorkPin] = useState<{ lat: number; lng: number } | null>(null);

  const [homeSuggestions, setHomeSuggestions] = useState<GeoSuggestion[]>([]);
  const [workSuggestions, setWorkSuggestions] = useState<GeoSuggestion[]>([]);
  const [homeCountryCode, setHomeCountryCode] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [fetchingRoute, setFetchingRoute] = useState(false);

  const [mapPickerTarget, setMapPickerTarget] = useState<"home" | "work" | null>(null);

  const [loading, setLoading] = useState(false);
  const [homeError, setHomeError] = useState("");
  const [workError, setWorkError] = useState("");

  // Prevent re-geocoding after a suggestion is selected
  const homeJustSelected = useRef(false);
  const workJustSelected = useRef(false);
  const homeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Version counters discard stale API responses (race-condition guard)
  const homeSearchSeq = useRef(0);
  const workSearchSeq = useRef(0);
  // AbortControllers cancel in-flight requests when a newer one starts
  const homeAbort = useRef<AbortController | null>(null);
  const workAbort = useRef<AbortController | null>(null);

  const isDriverFlow = profile?.role === "driver" || profile?.role === "both";
  const totalSteps = isDriverFlow ? 4 : 3;
  const progressWidth = `${(2 / totalSteps) * 100}%` as const;

  useEffect(() => {
    if (!fromProfile || !profile?.id || seededFromProfile.current) return;
    seededFromProfile.current = true;
    const hp = parseGeoPoint(profile.home_location);
    const pp = parseGeoPoint(profile.pickup_location);
    const wp = parseGeoPoint(profile.work_location);
    if (hp) {
      setHomePin(hp);
      setHomeAddress("Saved home location");
    } else if (pp) {
      setHomePin(pp);
      setHomeAddress("Saved trip start");
    }
    if (wp) {
      setWorkPin(wp);
      const wl = profile.work_location_label?.trim();
      setWorkAddress(wl || "Saved work location");
      if (wl) setWorkLabel(wl);
    }
  }, [
    fromProfile,
    profile?.id,
    profile?.home_location,
    profile?.pickup_location,
    profile?.work_location,
    profile?.work_location_label,
  ]);

  useEffect(() => {
    if (!fromProfile || !MAPBOX_TOKEN) return;
    let cancelled = false;
    if (
      homePin &&
      (homeAddress === "Saved home location" || homeAddress === "Saved trip start")
    ) {
      void reverseGeocodeShort(homePin.lat, homePin.lng).then((label) => {
        if (!cancelled && label) setHomeAddress(label);
      });
    }
    if (workPin && workAddress === "Saved work location") {
      void reverseGeocodeShort(workPin.lat, workPin.lng).then((label) => {
        if (!cancelled && label) setWorkAddress(label);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [fromProfile, homePin, workPin, homeAddress, workAddress]);

  useEffect(() => {
    if (homeTimer.current) clearTimeout(homeTimer.current);
    if (!homeAddress.trim() || homeAddress.trim().length < 3) {
      setHomeSuggestions([]);
      return;
    }
    if (homeJustSelected.current) {
      homeJustSelected.current = false;
      return;
    }
    homeTimer.current = setTimeout(async () => {
      // Cancel any previous in-flight request
      if (homeAbort.current) homeAbort.current.abort();
      const controller = new AbortController();
      homeAbort.current = controller;
      const seq = ++homeSearchSeq.current;
      try {
        const results = await geocodeSuggest(homeAddress, {
          includePOI: false,
          proximity: "ip",
          signal: controller.signal,
        });
        // Discard if a newer search has already started
        if (homeSearchSeq.current === seq) setHomeSuggestions(results);
      } catch {
        // AbortError = superseded by newer request, safe to ignore
      }
    }, 350);
    return () => {
      if (homeTimer.current) clearTimeout(homeTimer.current);
    };
  }, [homeAddress]);

  useEffect(() => {
    if (workTimer.current) clearTimeout(workTimer.current);
    if (!workAddress.trim() || workAddress.trim().length < 3) {
      setWorkSuggestions([]);
      return;
    }
    if (workJustSelected.current) {
      workJustSelected.current = false;
      return;
    }
    workTimer.current = setTimeout(async () => {
      // Cancel any previous in-flight request
      if (workAbort.current) workAbort.current.abort();
      const controller = new AbortController();
      workAbort.current = controller;
      const seq = ++workSearchSeq.current;
      const proximity = homePin ? `${homePin.lng},${homePin.lat}` : "ip";
      try {
        const results = await geocodeSuggest(workAddress, {
          includePOI: true,
          proximity,
          signal: controller.signal,
          countryCode: homeCountryCode ?? undefined,
        });
        if (workSearchSeq.current === seq) setWorkSuggestions(results);
      } catch {
        // AbortError = superseded, ignore
      }
    }, 350);
    return () => {
      if (workTimer.current) clearTimeout(workTimer.current);
    };
  }, [workAddress, homePin, homeCountryCode]);

  // Fetch driving route whenever both pins are set
  useEffect(() => {
    if (!homePin || !workPin) { setRouteInfo(null); return; }
    let cancelled = false;
    setFetchingRoute(true);
    fetchRouteInfo(homePin, workPin).then((info: RouteInfo | null) => {
      if (!cancelled) { setRouteInfo(info); setFetchingRoute(false); }
    });
    return () => { cancelled = true; };
  }, [homePin, workPin]);

  function selectHome(s: GeoSuggestion) {
    homeJustSelected.current = true;
    setHomeAddress(s.label);
    setHomePin({ lat: s.lat, lng: s.lng });
    if (s.countryCode) setHomeCountryCode(s.countryCode);
    setHomeSuggestions([]);
    if (homeError) setHomeError("");
  }

  function selectWork(s: GeoSuggestion) {
    workJustSelected.current = true;
    setWorkAddress(s.label);
    setWorkPin({ lat: s.lat, lng: s.lng });
    setWorkSuggestions([]);
    if (workError) setWorkError("");
  }

  function handleMapConfirm(lat: number, lng: number, address: string) {
    if (mapPickerTarget === "home") {
      homeJustSelected.current = true;
      setHomeAddress(address);
      setHomePin({ lat, lng });
      setHomeSuggestions([]);
      if (homeError) setHomeError("");
    } else if (mapPickerTarget === "work") {
      workJustSelected.current = true;
      setWorkAddress(address);
      setWorkPin({ lat, lng });
      setWorkSuggestions([]);
      if (workError) setWorkError("");
    }
    setMapPickerTarget(null);
  }

  async function handleContinue() {
    let valid = true;
    setHomeError("");
    setWorkError("");

    if (!homeAddress.trim()) {
      setHomeError("Please enter your home suburb or address.");
      valid = false;
    } else if (homeAddress.trim().length < 3 && !(fromProfile && homePin)) {
      setHomeError("Please enter a more specific address.");
      valid = false;
    }

    if (!workAddress.trim()) {
      setWorkError("Please enter your work or campus address.");
      valid = false;
    } else if (workAddress.trim().length < 3 && !(fromProfile && workPin)) {
      setWorkError("Please enter a more specific address.");
      valid = false;
    }

    if (!homePin || !workPin) {
      if (!homePin) setHomeError("Pin your home on the map or choose a suggestion.");
      if (!workPin) setWorkError("Pin your work on the map or choose a suggestion.");
      valid = false;
    }

    if (!valid) return;

    setLoading(true);

    const userId = profile?.id ?? session?.user?.id ?? null;
    if (!userId) {
      setLoading(false);
      showAlert(
        "Account not ready",
        "We could not confirm your sign-in yet. Go back to Home, pull to refresh, then try again."
      );
      return;
    }

    const updates: Record<string, unknown> = {
      work_location_label: workLabel.trim() || workAddress.trim(),
    };
    if (homePin) {
      updates.home_location = `POINT(${homePin.lng} ${homePin.lat})`;
    }
    if (workPin) {
      updates.work_location = `POINT(${workPin.lng} ${workPin.lat})`;
    }
    const { error: saveErr } = await supabase.from("users").update(updates).eq("id", userId);

    if (saveErr) {
      setLoading(false);
      showAlert(
        "Could not save locations",
        saveErr.message ||
          "The server rejected this update. If you recently changed the database, reload the API schema in Supabase."
      );
      return;
    }

    const routeRes = await upsertCommuteRouteToWork(userId, homePin!, workPin!);
    if (!routeRes.ok) {
      const fb = await upsertStraightLineCommuteRoute(userId, homePin!, workPin!);
      if (!fb.ok) {
        setLoading(false);
        await refreshProfile();
        showAlert(
          "Locations saved",
          `Your pins were saved, but we could not store a route line (${routeRes.error ?? fb.error}). You can retry from Profile → Commute.`
        );
        if (fromProfile) {
          router.replace("/(tabs)/profile/commute-locations");
        } else {
          router.push("/(onboarding)/schedule");
        }
        return;
      }
    }

    await refreshProfile();
    setLoading(false);
    if (fromProfile) {
      router.replace("/(tabs)/profile/commute-locations");
      return;
    }
    router.push("/(onboarding)/schedule");
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!fromProfile ? (
          <>
            <View style={styles.progress}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={styles.step}>Step 2 of {totalSteps}</Text>
          </>
        ) : (
          <Text style={styles.step}>Commute settings</Text>
        )}

        <Text style={styles.title}>
          {fromProfile ? "Update home & work" : "Where do you commute?"}
        </Text>
        <Text style={styles.subtitle}>
          We&apos;ll match using nearby streets, not your exact address. Other users
          only see your general area until you connect.
        </Text>

        {/* ── Home address card ── */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <View style={[styles.dot, styles.dotHome]} />
            <Text style={styles.locationTitle}>Home Address / Preferred Pickup Location</Text>
          </View>

          <View style={[styles.inputWrapper, homeError ? styles.inputWrapperError : null]}>
            <Ionicons
              name="home-outline"
              size={20}
              color={homeError ? Colors.error : Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Search home address or preferred pickup location"
              placeholderTextColor={Colors.textTertiary}
              value={homeAddress}
              onChangeText={(t) => {
                setHomeAddress(t);
                setHomePin(null);
                if (homeError) setHomeError("");
              }}
              autoComplete="street-address"
            />
          </View>

          {homeSuggestions.length > 0 && (
            <View style={styles.suggestionList}>
              {homeSuggestions.map((s) => (
                <TouchableOpacity
                  key={s.label}
                  style={styles.suggestionItem}
                  onPress={() => selectHome(s)}
                >
                  <Ionicons name="location-outline" size={14} color={Colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text style={styles.suggestionText} numberOfLines={2}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.pinRow}>
            {homePin ? (
              <View style={styles.pinnedBadge}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
                <Text style={styles.pinnedText}>Location pinned</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.mapPinBtn}
              onPress={() => setMapPickerTarget("home")}
              activeOpacity={0.8}
            >
              <Ionicons name="map-outline" size={14} color={Colors.primary} />
              <Text style={styles.mapPinBtnText}>Pick on map</Text>
            </TouchableOpacity>
          </View>

          {homeError ? <Text style={styles.fieldError}>{homeError}</Text> : null}
        </View>

        <View style={styles.connector}>
          <View style={styles.connectorLine} />
          <Ionicons name="swap-vertical" size={20} color={Colors.textTertiary} />
          <View style={styles.connectorLine} />
        </View>

        {/* ── Work address card ── */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <View style={[styles.dot, styles.dotWork]} />
            <Text style={styles.locationTitle}>Work / Campus</Text>
          </View>

          <View style={[styles.inputWrapper, workError ? styles.inputWrapperError : null]}>
            <Ionicons
              name="business-outline"
              size={20}
              color={workError ? Colors.error : Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Company name or office address"
              placeholderTextColor={Colors.textTertiary}
              value={workAddress}
              onChangeText={(t) => {
                setWorkAddress(t);
                setWorkPin(null);
                if (workError) setWorkError("");
              }}
              autoComplete="street-address"
            />
          </View>

          {workSuggestions.length > 0 && (
            <View style={styles.suggestionList}>
              {workSuggestions.map((s) => (
                <TouchableOpacity
                  key={s.label}
                  style={styles.suggestionItem}
                  onPress={() => selectWork(s)}
                >
                  <Ionicons name="location-outline" size={14} color={Colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text style={styles.suggestionText} numberOfLines={2}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.pinRow}>
            {workPin ? (
              <View style={styles.pinnedBadge}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
                <Text style={styles.pinnedText}>Location pinned</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.mapPinBtn}
              onPress={() => setMapPickerTarget("work")}
              activeOpacity={0.8}
            >
              <Ionicons name="map-outline" size={14} color={Colors.primary} />
              <Text style={styles.mapPinBtnText}>Pick on map</Text>
            </TouchableOpacity>
          </View>

          {workError ? <Text style={styles.fieldError}>{workError}</Text> : null}

          <View style={[styles.inputWrapper, { marginTop: Spacing.sm }]}>
            <Ionicons
              name="pricetag-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder='Label (e.g. "HQ" or "Building C")'
              placeholderTextColor={Colors.textTertiary}
              value={workLabel}
              onChangeText={setWorkLabel}
            />
          </View>
        </View>

        <View style={styles.privacyNote}>
          <Ionicons name="shield-checkmark-outline" size={20} color={Colors.primary} />
          <Text style={styles.privacyText}>
            Exact addresses stay private. We only use nearby street-level zones
            to match people on similar routes.
          </Text>
        </View>

        {/* ── Route preview — shown once both locations are pinned ── */}
        {homePin && workPin && MAPBOX_TOKEN ? (
          <View style={styles.routeCard}>
            <Image
              source={{ uri: buildStaticCommuteMapUrl(homePin, workPin, routeInfo) }}
              style={styles.routeMapImage}
              resizeMode="cover"
            />
            <View style={styles.routeInfo}>
              {/* Legend row */}
              <View style={styles.routeLegendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
                  <Text style={styles.routeLabel}>Home</Text>
                </View>
                <Ionicons name="arrow-forward" size={12} color={Colors.textTertiary} style={{ marginHorizontal: 6 }} />
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: "#E74C3C" }]} />
                  <Text style={styles.routeLabel}>Work</Text>
                </View>
                {routeInfo && routeInfo.alternates.length > 0 && (
                  <View style={styles.altBadge}>
                    <Text style={styles.altBadgeText}>
                      +{routeInfo.alternates.length} alternate {routeInfo.alternates.length === 1 ? "route" : "routes"}
                    </Text>
                  </View>
                )}
              </View>

              {/* Primary route stats */}
              {fetchingRoute ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 6 }} />
              ) : routeInfo ? (
                <>
                  <Text style={styles.routeStats}>
                    {routeInfo.primary.distanceKm.toFixed(1)} km
                    {" · "}
                    {routeInfo.primary.durationMin < 60
                      ? `~${Math.round(routeInfo.primary.durationMin)} min drive`
                      : `~${Math.floor(routeInfo.primary.durationMin / 60)}h ${Math.round(routeInfo.primary.durationMin % 60)}m drive`}
                  </Text>
                  {/* Alternate route times */}
                  {routeInfo.alternates.map((alt, i) => (
                    <Text key={i} style={styles.altRouteText}>
                      {i === 0 ? "🔵" : "🟡"}{" "}Alt {i + 1}:{" "}
                      {alt.distanceKm.toFixed(1)} km ·{" "}
                      {alt.durationMin < 60
                        ? `~${Math.round(alt.durationMin)} min`
                        : `~${Math.floor(alt.durationMin / 60)}h ${Math.round(alt.durationMin % 60)}m`}
                    </Text>
                  ))}
                </>
              ) : (
                <Text style={styles.routeStatsLight}>Loading routes…</Text>
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{fromProfile ? "Save" : "Continue"}</Text>
            <Ionicons name="arrow-forward" size={20} color={Colors.textOnPrimary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <MapPinPickerModal
        visible={mapPickerTarget !== null}
        initialLat={
          mapPickerTarget === "home" ? (homePin?.lat ?? -37.8136) : (workPin?.lat ?? -37.8136)
        }
        initialLng={
          mapPickerTarget === "home" ? (homePin?.lng ?? 144.9631) : (workPin?.lng ?? 144.9631)
        }
        onConfirm={handleMapConfirm}
        onClose={() => setMapPickerTarget(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 70,
    paddingBottom: Spacing["3xl"],
  },
  progress: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginBottom: Spacing.xl,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  step: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginBottom: Spacing["2xl"],
    lineHeight: 22,
  },
  locationCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.sm },
  dotHome: { backgroundColor: Colors.primary },
  dotWork: { backgroundColor: Colors.accent },
  locationTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  inputWrapperError: { borderColor: Colors.error },
  inputIcon: { marginRight: Spacing.sm },
  input: { flex: 1, fontSize: FontSize.base, color: Colors.text },
  suggestionList: {
    marginTop: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  suggestionText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  pinnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pinnedText: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: FontWeight.medium,
  },
  mapPinBtn: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: BorderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.primaryLight,
    marginLeft: "auto",
  },
  mapPinBtnText: {
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    fontWeight: FontWeight.semibold,
  },
  fieldError: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  connector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
  },
  connectorLine: {
    width: 1,
    height: 16,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.sm,
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  privacyText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.primaryDark,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing["2xl"],
  },
  backBtn: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  button: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.md,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  routeCard: {
    marginTop: Spacing.xl,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  routeMapImage: {
    width: "100%",
    height: 180,
  },
  routeInfo: {
    padding: Spacing.base,
  },
  routeLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    flexWrap: "wrap",
    gap: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  routeLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  altBadge: {
    marginLeft: "auto",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  altBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    fontWeight: FontWeight.medium,
  },
  routeStats: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 2,
  },
  altRouteText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  routeStatsLight: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
  },
});
