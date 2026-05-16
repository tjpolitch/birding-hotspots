import Papa from 'papaparse';
import { useState, useEffect, useMemo, useRef } from 'react';
import HotspotMap from './components/Map';
import './App.css';

const SETTINGS_KEY = 'ebird:settings';
const STORED_CSV_KEY = 'ebird:lastCsv';
const TOKEN_KEY = 'ebird:apiToken';

// Each user brings their own eBird API token. We read from localStorage and
// fall back to VITE_EBIRD_TOKEN for local dev convenience, but production
// builds should ship without an env-var token so every visitor uses their own.
function loadStoredToken(): string {
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  return (import.meta.env.VITE_EBIRD_TOKEN as string) ?? '';
}

type StoredSettings = {
  showUnvisitedOnly?: boolean;
  autoPanToSelection?: boolean;
  autoRestoreCSV?: boolean;
  targetMode?: boolean;
};

function loadStoredSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function App() {
  const initialSettings = loadStoredSettings();

  const [fileName, setFileName] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedSubregion, setSelectedSubregion] = useState("");
  const [hotspots, setHotspots] = useState<any[]>([]);
  const [isLoadingHotspots, setIsLoadingHotspots] = useState(false);
  const [subnational2, setSubnational2] = useState<{ code: string; name: string }[]>([]);
  const [countryList, setCountryList] = useState<{ code: string; name: string }[]>([]);
  const [regionList, setRegionList] = useState<{ code: string; name: string }[]>([]);
  const [showUnvisitedOnly, setShowUnvisitedOnly] = useState(initialSettings.showUnvisitedOnly ?? false);
  const [autoPanToSelection, setAutoPanToSelection] = useState(initialSettings.autoPanToSelection ?? true);
  const [autoRestoreCSV, setAutoRestoreCSV] = useState(initialSettings.autoRestoreCSV ?? true);
  const [targetMode, setTargetMode] = useState(initialSettings.targetMode ?? true);
  const [selectedTargetSpecies, setSelectedTargetSpecies] = useState("");
  const [ebirdToken, setEbirdToken] = useState(loadStoredToken);
  // Bounding box for the currently selected country, fetched from OpenStreetMap
  // Nominatim so the map can fly there even before a region is picked.
  const [countryBounds, setCountryBounds] = useState<
    { south: number; north: number; west: number; east: number } | null
  >(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchPoint, setSearchPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [isPickingOnMap, setIsPickingOnMap] = useState(false);
  const [focusHotspot, setFocusHotspot] = useState<{ locId: string; lat: number; lng: number; nonce: number } | null>(null);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const NEARBY_COUNT = 10;

  // Great-circle distance in km (Haversine).
  function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function findNearMe() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setSearchPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => alert('Could not get your location: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function pickOnMap() {
    setIsPickingOnMap(true);
  }

  function clearNearby() {
    setSearchPoint(null);
    setIsPickingOnMap(false);
  }

  function handleMapClick(lat: number, lng: number) {
    setSearchPoint({ lat, lng });
    setIsPickingOnMap(false);
  }

  // Persist the eBird token to localStorage whenever it changes.
  useEffect(() => {
    try {
      if (ebirdToken) localStorage.setItem(TOKEN_KEY, ebirdToken);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
  }, [ebirdToken]);

  // Persist setting toggles whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        showUnvisitedOnly,
        autoPanToSelection,
        autoRestoreCSV,
        targetMode,
      }));
    } catch { /* ignore quota errors */ }
  }, [showUnvisitedOnly, autoPanToSelection, autoRestoreCSV, targetMode]);

  // Country code prefix from a region code, e.g. "AU-NSW" -> "AU".
  const countryOf = (regionCode: string) => regionCode?.split("-")[0] ?? "";

  // Fetch the eBird country list once we have a token so we can display
  // friendly names. Re-runs when the user enters/updates their token.
  // We deliberately don't clear countryList when the token goes empty —
  // keeping the last-known list lets names keep resolving while the user
  // is in the middle of editing their token.
  useEffect(() => {
    if (!ebirdToken) return;
    async function fetchCountries() {
      try {
        const res = await fetch(
          "https://api.ebird.org/v2/ref/region/list/country/world",
          {
            headers: {
              "X-eBirdApiToken": ebirdToken,
              "Accept": "application/json",
            },
          }
        );
        if (!res.ok) {
          console.warn('eBird country list fetch failed:', res.status, res.statusText);
          return;
        }
        const json = await res.json();
        if (Array.isArray(json)) setCountryList(json);
      } catch (err) {
        console.warn('eBird country list fetch error:', err);
      }
    }
    fetchCountries();
  }, [ebirdToken]);

  // Fetch the eBird subnational1 list for the currently selected country, so
  // we can display friendly names (e.g. "New South Wales") in the dropdown
  // instead of raw codes (e.g. "AU-NSW").
  useEffect(() => {
    if (!selectedCountry || !ebirdToken) {
      setRegionList([]);
      return;
    }
    async function fetchRegions() {
      try {
        const res = await fetch(
          `https://api.ebird.org/v2/ref/region/list/subnational1/${selectedCountry}`,
          {
            headers: {
              "X-eBirdApiToken": ebirdToken,
              "Accept": "application/json",
            },
          }
        );
        if (!res.ok) {
          setRegionList([]);
          return;
        }
        const json = await res.json();
        setRegionList(Array.isArray(json) ? json : []);
      } catch {
        setRegionList([]);
      }
    }
    fetchRegions();
  }, [selectedCountry, ebirdToken]);

  // Look up the selected country's bounding box from OpenStreetMap Nominatim
  // so the map can fly to it (since eBird's country endpoint doesn't include
  // coordinates). Free, no key required. Cached in memory per session.
  // A cancellation flag prevents a slow response for the previous country from
  // overwriting bounds the user has since moved on from.
  const countryBoundsCacheRef = useRef<Map<string, { south: number; north: number; west: number; east: number }>>(new Map());
  useEffect(() => {
    // Always clear first so stale bounds from a previous country don't
    // linger while we fetch the new ones — this avoids "I picked Japan but
    // it flew to Albania" (the prior fetch finishing late).
    setCountryBounds(null);
    if (!selectedCountry) return;

    const cached = countryBoundsCacheRef.current.get(selectedCountry);
    if (cached) {
      setCountryBounds(cached);
      return;
    }

    let cancelled = false;
    async function fetchCountryBounds() {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?country=${selectedCountry}&format=json&limit=1`,
          { headers: { 'Accept': 'application/json' } }
        );
        if (cancelled || !res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        // bbox is [south, north, west, east] as strings.
        const bbox = json?.[0]?.boundingbox;
        if (!Array.isArray(bbox) || bbox.length !== 4) return;
        const bounds = {
          south: parseFloat(bbox[0]),
          north: parseFloat(bbox[1]),
          west: parseFloat(bbox[2]),
          east: parseFloat(bbox[3]),
        };
        countryBoundsCacheRef.current.set(selectedCountry, bounds);
        setCountryBounds(bounds);
      } catch (err) {
        if (!cancelled) console.warn('Country bounds lookup failed:', err);
      }
    }
    fetchCountryBounds();
    return () => { cancelled = true; };
  }, [selectedCountry]);

  function parseCSVText(name: string, text: string) {
    setFileName(name);

    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as any[];
        setData(rows);

        // Auto-select the region with the most unique visited hotspots.
        const regionCounts = new Map<string, Set<string>>();
        for (const r of rows) {
          const region = r["State/Province"]?.trim();
          const locId = r["Location ID"]?.trim();
          if (!region || !locId || !locId.startsWith("L")) continue;
          if (!regionCounts.has(region)) regionCounts.set(region, new Set());
          regionCounts.get(region)!.add(locId);
        }
        let bestRegion = "";
        let bestRegionCount = -1;
        for (const [region, locs] of regionCounts) {
          if (locs.size > bestRegionCount) {
            bestRegionCount = locs.size;
            bestRegion = region;
          }
        }
        if (!bestRegion) return;
        setSelectedCountry(countryOf(bestRegion));
        setSelectedRegion(bestRegion);

        // Within that region, auto-select the subregion with the most unique
        // visited hotspots (if any).
        const subregionCounts = new Map<string, Set<string>>();
        for (const r of rows) {
          if (r["State/Province"]?.trim() !== bestRegion) continue;
          const subregion = r["County"]?.trim();
          const locId = r["Location ID"]?.trim();
          if (!subregion || !locId || !locId.startsWith("L")) continue;
          if (!subregionCounts.has(subregion)) subregionCounts.set(subregion, new Set());
          subregionCounts.get(subregion)!.add(locId);
        }
        let bestSubregion = "";
        let bestSubCount = -1;
        for (const [sub, locs] of subregionCounts) {
          if (locs.size > bestSubCount) {
            bestSubCount = locs.size;
            bestSubregion = sub;
          }
        }
        setSelectedSubregion(bestSubregion);
      }
    });
  }

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please upload a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? '';
      if (autoRestoreCSV) {
        try {
          localStorage.setItem(STORED_CSV_KEY, JSON.stringify({ name: file.name, text }));
        } catch {
          console.warn('CSV too large to cache in local storage.');
        }
      }
      parseCSVText(file.name, text);
    };
    reader.readAsText(file);
  }

  // On first mount, restore a previously-loaded CSV if the setting is enabled.
  // Empty deps + ref guard so this runs once per app load.
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    if (!autoRestoreCSV) return;
    try {
      const raw = localStorage.getItem(STORED_CSV_KEY);
      if (!raw) return;
      const { name, text } = JSON.parse(raw);
      if (name && text) parseCSVText(name, text);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearStoredCSV() {
    try { localStorage.removeItem(STORED_CSV_KEY); } catch { /* ignore */ }
  }

  function handleFileUpload(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    processFile(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  // 🌍 Dynamic hotspot fetch
  useEffect(() => {
    if (!selectedRegion || !ebirdToken) {
      setHotspots([]);
      setSubnational2([]);
      return;
    }
    // Clear any prior region's hotspots so the map can't briefly fly to the
    // wrong bounds while the new region is loading.
    setHotspots([]);
    setSubnational2([]);

    async function fetchHotspots() {
      setIsLoadingHotspots(true);
      try {
        const res = await fetch(
          `https://api.ebird.org/v2/ref/hotspot/${selectedRegion}?fmt=json`,
          {
            headers: {
              "X-eBirdApiToken": ebirdToken,
              "Accept": "application/json"
            }
          }
        );

        const data = await res.json();
        setHotspots(data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingHotspots(false);
      }
    }

    fetchHotspots();

    // Fetch the authoritative subregion (subnational2) list for this state
    async function fetchSubnational2() {
      try {
        const res = await fetch(
          `https://api.ebird.org/v2/ref/region/list/subnational2/${selectedRegion}`,
          {
            headers: {
              "X-eBirdApiToken": ebirdToken,
              "Accept": "application/json",
            },
          }
        );
        if (!res.ok) {
          setSubnational2([]);
          return;
        }
        const json = await res.json();
        setSubnational2(Array.isArray(json) ? json : []);
      } catch {
        setSubnational2([]);
      }
    }
    fetchSubnational2();
  }, [selectedRegion, ebirdToken]);

  // Dropdowns
  const countryNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countryList) if (c?.code && c?.name) m.set(c.code, c.name);
    return m;
  }, [countryList]);

  // Countries: split into visited (from CSV) and unvisited (rest of world).
  const countries = useMemo(() => {
    const visitedSet = new Set<string>();
    for (const r of data) {
      const code = countryOf(r["State/Province"]?.trim() ?? "");
      if (code) visitedSet.add(code);
    }
    const source = countryList.length > 0
      ? countryList
      : Array.from(visitedSet).map(code => ({ code, name: code }));
    const withNames = source.map(c => ({
      code: c.code,
      name: countryNameByCode.get(c.code) ?? c.name ?? c.code,
    }));
    const visited = withNames
      .filter(c => visitedSet.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));
    const unvisited = withNames
      .filter(c => !visitedSet.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { visited, unvisited };
  }, [data, countryList, countryNameByCode]);

  const regionNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regionList) if (r?.code && r?.name) m.set(r.code, r.name);
    return m;
  }, [regionList]);

  // Regions: scoped to selected country, split into visited/unvisited.
  const regions = useMemo(() => {
    const visitedSet = new Set<string>();
    for (const r of data) {
      const code = r["State/Province"]?.trim();
      if (!code) continue;
      if (selectedCountry && countryOf(code) !== selectedCountry) continue;
      visitedSet.add(code);
    }
    const apiInCountry = regionList.filter(
      r => !selectedCountry || countryOf(r.code) === selectedCountry
    );
    const merged = new Map<string, string>();
    for (const r of apiInCountry) merged.set(r.code, r.name);
    for (const code of visitedSet) {
      if (!merged.has(code)) merged.set(code, regionNameByCode.get(code) ?? code);
    }
    const all = Array.from(merged, ([code, name]) => ({ code, name }));
    const visited = all
      .filter(r => visitedSet.has(r.code))
      .sort((a, b) => a.name.localeCompare(b.name));
    const unvisited = all
      .filter(r => !visitedSet.has(r.code))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { visited, unvisited };
  }, [data, regionList, regionNameByCode, selectedCountry]);

  // Subregions: scoped to selected region, split into visited/unvisited.
  const subregions = useMemo(() => {
    const visitedNames = new Set<string>();
    for (const r of data) {
      if (selectedRegion && r["State/Province"]?.trim() !== selectedRegion) continue;
      const name = r["County"]?.trim();
      if (name) visitedNames.add(name);
    }
    const apiNames = subnational2.map(s => s.name).filter(Boolean);
    const all = Array.from(new Set<string>([...apiNames, ...visitedNames]));
    const visited = all.filter(n => visitedNames.has(n)).sort();
    const unvisited = all.filter(n => !visitedNames.has(n)).sort();
    return { visited, unvisited };
  }, [data, subnational2, selectedRegion]);

  const filteredData = useMemo(
    () => data.filter(r =>
      (!selectedRegion || r["State/Province"] === selectedRegion) &&
      (!selectedSubregion || r["County"] === selectedSubregion)
    ),
    [data, selectedRegion, selectedSubregion]
  );

  // Memoized so the downstream useMemos (targetHotspotsList, nearbyUnvisited)
  // don't rebuild on every render. With thousands of markers this matters.
  const visitedHotspots = useMemo(
    () => new Set<string>(
      filteredData
        .map(r => r["Location ID"]?.trim())
        .filter((id: string | undefined) => !!id && id.startsWith("L"))
    ),
    [filteredData]
  );

  // For each location the user has visited, compute # distinct species seen
  // and the most recent observation date. Used to enrich the marker popups.
  const userStatsByLoc = useMemo(() => {
    const speciesByLoc = new Map<string, Set<string>>();
    const lastDateByLoc = new Map<string, string>();
    for (const r of data) {
      const id = r["Location ID"]?.trim();
      if (!id || !id.startsWith("L")) continue;
      const species = r["Common Name"]?.trim();
      if (species) {
        if (!speciesByLoc.has(id)) speciesByLoc.set(id, new Set());
        speciesByLoc.get(id)!.add(species);
      }
      const date = r["Date"]?.trim();
      if (date) {
        const prev = lastDateByLoc.get(id);
        if (!prev || date > prev) lastDateByLoc.set(id, date);
      }
    }
    const out = new Map<string, { speciesCount: number; lastVisit: string }>();
    for (const [id, species] of speciesByLoc) {
      out.set(id, { speciesCount: species.size, lastVisit: lastDateByLoc.get(id) ?? '' });
    }
    return out;
  }, [data]);

  // Clear the target species if it's no longer in the current scope (e.g. the
  // user switched regions). Prevents the map from highlighting based on a
  // stale species that the dropdown can no longer show.
  useEffect(() => {
    if (!selectedTargetSpecies) return;
    const stillVisible = data.some(r => {
      if (r["Common Name"]?.trim() !== selectedTargetSpecies) return false;
      const regionCode = r["State/Province"]?.trim();
      if (selectedCountry && countryOf(regionCode ?? "") !== selectedCountry) return false;
      if (selectedRegion && regionCode !== selectedRegion) return false;
      if (selectedSubregion && r["County"]?.trim() !== selectedSubregion) return false;
      return true;
    });
    if (!stillVisible) setSelectedTargetSpecies("");
  }, [selectedTargetSpecies, selectedCountry, selectedRegion, selectedSubregion, data]);

  // Sorted unique species names scoped to the current country/region/subregion
  // selection — drives the target picker. Filtering here keeps the list to
  // species the user has logged inside the area they're looking at.
  const allSpecies = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      const regionCode = r["State/Province"]?.trim();
      if (selectedCountry && countryOf(regionCode ?? "") !== selectedCountry) continue;
      if (selectedRegion && regionCode !== selectedRegion) continue;
      if (selectedSubregion && r["County"]?.trim() !== selectedSubregion) continue;
      const name = r["Common Name"]?.trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data, selectedCountry, selectedRegion, selectedSubregion]);

  // Map of species name -> set of locIds where the user has recorded it.
  // Used to figure out which scoped hotspots are "targets" (visited, no record).
  const speciesToLocs = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of data) {
      const name = r["Common Name"]?.trim();
      const id = r["Location ID"]?.trim();
      if (!name || !id || !id.startsWith("L")) continue;
      if (!m.has(name)) m.set(name, new Set());
      m.get(name)!.add(id);
    }
    return m;
  }, [data]);

  // Authoritative Subregion Name -> subnational2 code map from the eBird API.
  // Falls back to deriving from CSV+hotspots if the API list is empty.
  const subregionNameToCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of subnational2) {
      if (c?.name && c?.code) map.set(c.name, c.code);
    }
    if (map.size === 0) {
      const csvLocToSubregion = new Map<string, string>();
      for (const r of data) {
        const id = r["Location ID"]?.trim();
        const subregion = r["County"]?.trim();
        if (id && subregion) csvLocToSubregion.set(id, subregion);
      }
      for (const h of hotspots) {
        const subregion = csvLocToSubregion.get(h.locId);
        if (subregion && h.subnational2Code) map.set(subregion, h.subnational2Code);
      }
    }
    return map;
  }, [subnational2, data, hotspots]);

  // Hotspots filtered to the selected subregion (if any).
  const hotspotsInScope = useMemo(() => {
    if (!selectedSubregion) return hotspots;
    const code = subregionNameToCode.get(selectedSubregion);
    if (!code) return [];
    return hotspots.filter(h => h.subnational2Code === code);
  }, [hotspots, selectedSubregion, subregionNameToCode]);

  // Completion (scoped to the current state/subregion selection)
  const visitedCount = hotspotsInScope.filter(h =>
    visitedHotspots.has(h.locId)
  ).length;

  const completion =
    hotspotsInScope.length > 0
      ? Math.round((visitedCount / hotspotsInScope.length) * 100)
      : 0;

  // Nearest unvisited hotspots to `searchPoint`, within the current scope.
  const nearbyUnvisited = useMemo(() => {
    if (!searchPoint) return [];
    return hotspotsInScope
      .filter(h => !visitedHotspots.has(h.locId))
      .map(h => ({
        ...h,
        distanceKm: distanceKm(searchPoint.lat, searchPoint.lng, Number(h.lat), Number(h.lng)),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, NEARBY_COUNT);
  }, [searchPoint, hotspotsInScope, visitedHotspots]);

  // Locations where the user has recorded the selected target species.
  const speciesLocs = useMemo(() => {
    if (!selectedTargetSpecies) return new Set<string>();
    return speciesToLocs.get(selectedTargetSpecies) ?? new Set<string>();
  }, [selectedTargetSpecies, speciesToLocs]);

  // "Target" hotspots: in current scope, user has birded here (visitedHotspots)
  // but never recorded the selected species here.
  const targetHotspotsList = useMemo(() => {
    if (!selectedTargetSpecies) return [];
    return hotspotsInScope
      .filter(h => visitedHotspots.has(h.locId) && !speciesLocs.has(h.locId))
      .sort((a, b) => (b.numSpeciesAllTime ?? 0) - (a.numSpeciesAllTime ?? 0));
  }, [selectedTargetSpecies, hotspotsInScope, visitedHotspots, speciesLocs]);

  // Set form for fast Map lookups.
  const targetLocIds = useMemo(
    () => new Set(targetHotspotsList.map(h => h.locId)),
    [targetHotspotsList]
  );

  // # of in-scope hotspots where the user has recorded the target species —
  // drives the Stats box when target mode is on.
  const targetRecordedCount = useMemo(() => {
    if (!selectedTargetSpecies) return 0;
    return hotspotsInScope.filter(h => speciesLocs.has(h.locId)).length;
  }, [selectedTargetSpecies, hotspotsInScope, speciesLocs]);

  const targetCoverage = hotspotsInScope.length > 0
    ? Math.round((targetRecordedCount / hotspotsInScope.length) * 100)
    : 0;

  const fileLoaded = Boolean(fileName);

  return (
    <div
      className={`app${isDragging ? ' dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>Drop your eBird CSV to load it</p>
          </div>
        </div>
      )}
      <aside className="sidebar">
        {/* Brand */}
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="brand-title">eBird Hotspots</h1>
            <p className="brand-subtitle">Track your birding progress</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setIsSettingsOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        {/* File upload */}
        <div className="section">
          <p className="section-label">Data</p>
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            accept=".csv"
            className="file-input"
            onChange={handleFileUpload}
          />
          {!fileLoaded ? (
            <label htmlFor="file-input" className="file-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload eBird CSV
            </label>
          ) : (
            <div className="file-loaded">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="file-loaded-name">{fileName}</span>
              <button
                type="button"
                className="file-change"
                onClick={() => fileInputRef.current?.click()}
              >
                Change
              </button>
            </div>
          )}
          {!fileLoaded && (
            <p className="empty-hint">Upload your eBird data export to begin.</p>
          )}
        </div>

        {/* Filters */}
        <div className="section">
          <p className="section-label">Country</p>
          <select
            className="select"
            value={selectedCountry}
            onChange={(e) => {
              setSelectedCountry(e.target.value);
              setSelectedRegion("");
              setSelectedSubregion("");
              // Clear stale data synchronously so the next render can't briefly
              // use the previous country's bounds or hotspots — that would
              // cause FlyToBounds to lock onto the wrong location.
              setCountryBounds(null);
              setHotspots([]);
            }}
            disabled={!fileLoaded || (countries.visited.length + countries.unvisited.length) === 0}
          >
            {!fileLoaded || (countries.visited.length === 0 && countries.unvisited.length === 0) ? (
              <option value="">—</option>
            ) : (
              <>
                {countries.visited.length > 0 && (
                  <optgroup label="Visited">
                    {countries.visited.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </optgroup>
                )}
                {countries.unvisited.length > 0 && (
                  <optgroup label="Not visited">
                    {countries.unvisited.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </optgroup>
                )}
              </>
            )}
          </select>
        </div>

        <div className="section">
          <p className="section-label">Region</p>
          <select
            className="select"
            value={selectedRegion}
            onChange={(e) => {
              setSelectedRegion(e.target.value);
              setSelectedSubregion("");
              // Same reason as the country handler — drop stale hotspots so
              // FlyToBounds can't lock onto the previous region's bounds.
              setHotspots([]);
            }}
            disabled={!fileLoaded || (regions.visited.length + regions.unvisited.length) === 0}
          >
            {regions.visited.length === 0 && regions.unvisited.length === 0 ? (
              <option value="">—</option>
            ) : (
              <>
                <option value="">All regions</option>
                {regions.visited.length > 0 && (
                  <optgroup label="Visited">
                    {regions.visited.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </optgroup>
                )}
                {regions.unvisited.length > 0 && (
                  <optgroup label="Not visited">
                    {regions.unvisited.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </optgroup>
                )}
              </>
            )}
          </select>
        </div>

        <div className="section">
          <p className="section-label">Subregion</p>
          <select
            className="select"
            value={selectedSubregion}
            onChange={(e) => setSelectedSubregion(e.target.value)}
            disabled={!fileLoaded || (subregions.visited.length + subregions.unvisited.length) === 0}
          >
            {!fileLoaded ? (
              <option value="">—</option>
            ) : (
              <>
                <option value="">
                  {(subregions.visited.length + subregions.unvisited.length) === 0 ? 'No subregions' : 'All subregions'}
                </option>
                {subregions.visited.length > 0 && (
                  <optgroup label="Visited">
                    {subregions.visited.map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
                {subregions.unvisited.length > 0 && (
                  <optgroup label="Not visited">
                    {subregions.unvisited.map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
              </>
            )}
          </select>
        </div>

        {/* Stats — swaps to species-relative numbers when target mode is on. */}
        {fileLoaded && (
          <div className="stats">
            {targetMode ? (
              <>
                <div className="stat-row">
                  <span className="stat-label">Recorded</span>
                  <span className="stat-value">{targetRecordedCount}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {hotspotsInScope.length}</span></span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Coverage</span>
                  <span className="stat-value" style={{ color: 'var(--accent)' }}>{targetCoverage}%</span>
                </div>
                <div className="progress" aria-hidden="true">
                  <div className="progress-bar" style={{ width: `${targetCoverage}%` }} />
                </div>
              </>
            ) : (
              <>
                <div className="stat-row">
                  <span className="stat-label">Visited</span>
                  <span className="stat-value">{visitedCount}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {hotspotsInScope.length}</span></span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Completion</span>
                  <span className="stat-value" style={{ color: 'var(--accent)' }}>{completion}%</span>
                </div>
                <div className="progress" aria-hidden="true">
                  <div className="progress-bar" style={{ width: `${completion}%` }} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Nearby unvisited — hidden when target mode is active so the sidebar
            focuses on the target-species workflow. */}
        {fileLoaded && !targetMode && (
          <div className="section">
            <p className="section-label">Nearby unvisited</p>
            <div className="nearby-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={findNearMe}
                disabled={hotspotsInScope.length === 0}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
                Near me
              </button>
              <button
                type="button"
                className={`btn-secondary${isPickingOnMap ? ' active' : ''}`}
                onClick={pickOnMap}
                disabled={hotspotsInScope.length === 0}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {isPickingOnMap ? 'Click the map…' : 'Pick on map'}
              </button>
            </div>

            {searchPoint && (
              <div className="nearby-list">
                {nearbyUnvisited.length === 0 ? (
                  <p className="empty-hint">No unvisited hotspots in scope.</p>
                ) : (
                  <>
                    {nearbyUnvisited.map(h => (
                      <button
                        key={h.locId}
                        type="button"
                        className="nearby-item"
                        onClick={() =>
                          setFocusHotspot({
                            locId: h.locId,
                            lat: Number(h.lat),
                            lng: Number(h.lng),
                            nonce: Date.now(),
                          })
                        }
                      >
                        <span className="nearby-name">{h.locName}</span>
                        <span className="nearby-distance">{h.distanceKm < 10 ? h.distanceKm.toFixed(1) : Math.round(h.distanceKm)} km</span>
                      </button>
                    ))}
                    <button type="button" className="setting-link nearby-clear" onClick={clearNearby}>Clear</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Target species — only shown when target mode is enabled in Settings. */}
        {fileLoaded && targetMode && (
          <div className="section">
            <p className="section-label">Target species</p>
            <select
              className="select"
              value={selectedTargetSpecies}
              onChange={(e) => setSelectedTargetSpecies(e.target.value)}
              disabled={allSpecies.length === 0}
            >
              <option value="">{allSpecies.length === 0 ? '—' : 'Choose a species…'}</option>
              {allSpecies.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {selectedTargetSpecies && (
              targetHotspotsList.length === 0 ? (
                <p className="empty-hint">
                  {speciesLocs.size > 0
                    ? "You've recorded this species at every hotspot you've birded in scope."
                    : "No targets in scope — you haven't birded any hotspot here yet."}
                </p>
              ) : (
                <div className="nearby-list">
                  {targetHotspotsList.slice(0, 15).map(h => (
                    <button
                      key={h.locId}
                      type="button"
                      className="nearby-item"
                      onClick={() =>
                        setFocusHotspot({
                          locId: h.locId,
                          lat: Number(h.lat),
                          lng: Number(h.lng),
                          nonce: Date.now(),
                        })
                      }
                    >
                      <span className="nearby-name">{h.locName}</span>
                      {typeof h.numSpeciesAllTime === 'number' && (
                        <span className="nearby-distance">{h.numSpeciesAllTime} spp</span>
                      )}
                    </button>
                  ))}
                  {targetHotspotsList.length > 15 && (
                    <p className="empty-hint" style={{ marginTop: 4 }}>
                      …and {targetHotspotsList.length - 15} more
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        )}

        {/* Legend */}
        <div className="section" style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <p className="section-label">Legend</p>
          <div className="legend">
            {targetMode ? (
              <>
                <div className="legend-item"><span className="legend-dot visited" /> Visited &amp; recorded</div>
                <div className="legend-item"><span className="legend-dot target" /> Visited &amp; not recorded</div>
                <div className="legend-item"><span className="legend-dot unvisited" /> Not visited</div>
              </>
            ) : (
              <>
                <div className="legend-item"><span className="legend-dot visited" /> Visited</div>
                <div className="legend-item"><span className="legend-dot unvisited" /> Not visited</div>
                <div className="legend-item"><span className="legend-dot partial" /> Cluster (some visited)</div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Settings modal */}
      {isSettingsOpen && (
        <div
          className="modal-overlay"
          onClick={() => setIsSettingsOpen(false)}
          onDragEnter={(e) => e.stopPropagation()}
          onDragOver={(e) => e.stopPropagation()}
          onDrop={(e) => e.stopPropagation()}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="settings-title" className="modal-title">Settings</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setIsSettingsOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="setting-row setting-row-stack">
                <div>
                  <div className="setting-title">eBird API token</div>
                  <div className="setting-desc">
                    Required to load hotspots and region data. Get a free token at{' '}
                    <a
                      href="https://ebird.org/api/keygen"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="setting-link"
                    >
                      ebird.org/api/keygen
                    </a>
                    . Stored locally in your browser — never sent anywhere except eBird.
                  </div>
                </div>
                <input
                  type="text"
                  className="setting-input"
                  placeholder="Paste your eBird API token"
                  value={ebirdToken}
                  onChange={(e) => setEbirdToken(e.target.value.trim())}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-title">Only show unvisited</div>
                  <div className="setting-desc">
                    Hide hotspots you've already birded.
                    {targetMode && (
                      <span style={{ color: 'var(--text-dim)' }}> Has no effect in target species mode.</span>
                    )}
                  </div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={showUnvisitedOnly}
                    onChange={(e) => setShowUnvisitedOnly(e.target.checked)}
                  />
                  <span className="toggle-switch" />
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-title">Target species mode</div>
                  <div className="setting-desc">Pick a species you want to chase. The map highlights hotspots in scope where you've birded but haven't yet recorded it — likely places to try next.</div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={targetMode}
                    onChange={(e) => setTargetMode(e.target.checked)}
                  />
                  <span className="toggle-switch" />
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-title">Auto-pan to selection</div>
                  <div className="setting-desc">Zoom the map to fit when you pick a country, region, or subregion.</div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={autoPanToSelection}
                    onChange={(e) => setAutoPanToSelection(e.target.checked)}
                  />
                  <span className="toggle-switch" />
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-title">Auto-restore last CSV</div>
                  <div className="setting-desc">
                    Reload your most recent eBird export automatically when you open the app.{' '}
                    <button
                      type="button"
                      className="setting-link"
                      onClick={clearStoredCSV}
                    >
                      Clear stored CSV
                    </button>
                  </div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={autoRestoreCSV}
                    onChange={(e) => {
                      setAutoRestoreCSV(e.target.checked);
                      if (!e.target.checked) clearStoredCSV();
                    }}
                  />
                  <span className="toggle-switch" />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="map-wrapper">
        {isLoadingHotspots && (
          <div className="map-loading" role="status" aria-live="polite">
            <div className="map-loading-bar" />
            <div className="map-loading-text">
              <span className="spinner" aria-hidden="true" />
              Loading hotspots…
            </div>
          </div>
        )}
        {!ebirdToken && (
          <div className="map-toast map-toast-warn" role="status" style={{ pointerEvents: 'auto' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              Add your eBird API token to load hotspots.{' '}
              <button
                type="button"
                className="setting-link"
                onClick={() => setIsSettingsOpen(true)}
              >
                Open Settings
              </button>
            </span>
          </div>
        )}
        {ebirdToken && fileLoaded && targetMode && !selectedTargetSpecies && (
          <div className="map-toast" role="status">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Pick a target species to highlight matching hotspots.</span>
          </div>
        )}
        <HotspotMap
          hotspots={
            // In target mode, "only show unvisited" is ignored — filtering
            // away visited hotspots would hide the green/amber categories
            // that the mode is designed to surface.
            showUnvisitedOnly && !targetMode
              ? hotspotsInScope.filter(h => !visitedHotspots.has(h.locId))
              : hotspotsInScope
          }
          visitedHotspots={visitedHotspots}
          userStatsByLoc={userStatsByLoc}
          flyToBoundsKey={`${selectedCountry}|${selectedRegion}|${selectedSubregion}`}
          flyToEnabled={autoPanToSelection}
          searchPoint={searchPoint}
          isPickingOnMap={isPickingOnMap}
          onMapClick={handleMapClick}
          focusHotspot={focusHotspot}
          targetMode={targetMode}
          targetSpecies={selectedTargetSpecies}
          targetLocIds={targetLocIds}
          speciesLocIds={speciesLocs}
          fallbackBounds={selectedRegion ? null : countryBounds}
        />
      </main>
    </div>
  );
}

export default App;
