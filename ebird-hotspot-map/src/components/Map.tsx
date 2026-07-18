import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Zoom level at which clustering turns off (see disableClusteringAtZoom).
// Also the threshold past which the app loads viewport hotspots across
// region borders.
export const CLUSTER_OFF_ZOOM = 12;

// Marker rendered at the user's search point (geolocated or clicked).
const searchPointIcon = L.divIcon({
  className: 'search-point-marker',
  html: '<span class="search-point-dot"></span><span class="search-point-pulse"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Modern circular dot markers — styled in App.css via the .hotspot-marker class.
// We keep two distinct icon references so cluster colouring can detect
// visited vs unvisited via reference equality.
const greenIcon = L.divIcon({
  className: 'hotspot-marker visited',
  html: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -8],
});

const redIcon = L.divIcon({
  className: 'hotspot-marker unvisited',
  html: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -8],
});

// "Target": hotspot the user has visited but where they haven't recorded the
// selected target species. Used only when target species mode is active.
const targetIcon = L.divIcon({
  className: 'hotspot-marker target',
  html: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -9],
});

// 🧠 Custom cluster colouring
// In target mode: a cluster containing any target marker is highlighted amber;
// otherwise behaves like the normal visited/partial/unvisited variants.
function createClusterCustomIcon(cluster: any) {
  const markers = cluster.getAllChildMarkers();
  const count = markers.length;

  let visitedCount = 0;
  let targetCount = 0;
  markers.forEach((m: any) => {
    // Compare by icon reference — far more reliable than trying to pass custom
    // props through react-leaflet to the underlying L.Marker.
    const icon = m.options?.icon;
    if (icon === greenIcon) visitedCount++;
    else if (icon === targetIcon) targetCount++;
  });

  let variant: string;
  if (targetCount > 0) {
    variant = 'target';
  } else if (count > 0 && visitedCount === count) {
    variant = 'visited';
  } else if (visitedCount > 0) {
    variant = 'partial';
  } else {
    variant = 'unvisited';
  }

  // Size buckets so dense clusters read more strongly than sparse ones.
  const size = count < 10 ? 32 : count < 100 ? 38 : 46;

  return L.divIcon({
    html: `<div class="cluster cluster-${variant}" style="width:${size}px;height:${size}px;line-height:${size}px;">${count}</div>`,
    className: 'cluster-wrapper',
    iconSize: L.point(size, size, true),
  });
}

function formatDate(iso: string) {
  // Accepts "YYYY-MM-DD" and returns "12 Mar 2026" style.
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

function HotspotPopup({
  h,
  visited,
  userStats,
  targetMode,
  targetSpecies,
  hasSpeciesHere,
  isTarget,
}: {
  h: any;
  visited: boolean;
  userStats?: { speciesCount: number; lastVisit: string };
  targetMode?: boolean;
  targetSpecies?: string;
  hasSpeciesHere?: boolean;
  isTarget?: boolean;
}) {
  const allTimeSpecies = h.numSpeciesAllTime;
  const ebirdUrl = `https://ebird.org/hotspot/${h.locId}`;
  // In target mode, the badge reflects the species-relative status; otherwise
  // it's the regular visited/not-visited indicator.
  const badgeClass = targetMode
    ? hasSpeciesHere ? 'visited' : isTarget ? 'target' : 'unvisited'
    : visited ? 'visited' : 'unvisited';
  const badgeText = targetMode
    ? hasSpeciesHere ? 'Recorded here' : isTarget ? 'Target' : 'Not visited'
    : visited ? 'Visited' : 'Not visited';
  return (
    <div className="popup">
      <div className="popup-header">
        <h3 className="popup-title">{h.locName}</h3>
        <span className={`popup-badge ${badgeClass}`}>{badgeText}</span>
      </div>

      {targetMode && targetSpecies && (
        <div className="popup-target">
          <span className="popup-target-label">{targetSpecies}:</span>{' '}
          {hasSpeciesHere
            ? "you've recorded it here"
            : isTarget
              ? "you've birded here but haven't recorded it"
              : "you haven't birded here"}
        </div>
      )}

      {(visited && userStats) && (
        <div className="popup-stats">
          <div className="popup-stat">
            <div className="popup-stat-value">{userStats.speciesCount}</div>
            <div className="popup-stat-label">Your species</div>
          </div>
          {userStats.lastVisit && (
            <div className="popup-stat">
              <div className="popup-stat-value">{formatDate(userStats.lastVisit)}</div>
              <div className="popup-stat-label">Last visit</div>
            </div>
          )}
        </div>
      )}

      {typeof allTimeSpecies === 'number' && (
        <div className="popup-meta">
          <span>{allTimeSpecies.toLocaleString()} species all-time</span>
        </div>
      )}

      <a className="popup-link" href={ebirdUrl} target="_blank" rel="noopener noreferrer">
        View on eBird
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17L17 7" />
          <polyline points="7 7 17 7 17 17" />
        </svg>
      </a>
    </div>
  );
}

// 🧠 Render all markers once and let MarkerClusterGroup handle culling/clustering.
// Memoized so we don't rebuild the marker list on every map pan/zoom.
function AllMarkers({
  hotspots,
  visitedHotspots,
  userStatsByLoc,
  targetMode,
  targetSpecies,
  targetLocIds,
  speciesLocIds,
}: any) {
  return useMemo(
    () => (
      <>
        {hotspots.map((h: any) => {
          const visited = visitedHotspots.has(h.locId);
          const hasSpeciesHere = !!speciesLocIds?.has(h.locId);
          const isTarget = !!targetLocIds?.has(h.locId);
          // In target mode, icon choice reflects species status:
          //  - species recorded here     → green
          //  - target (visited, missing) → amber/target
          //  - never visited             → red (same as normal mode)
          // Otherwise just the regular visited/unvisited dots.
          const icon = targetMode
            ? hasSpeciesHere ? greenIcon : isTarget ? targetIcon : redIcon
            : visited ? greenIcon : redIcon;
          return (
            <Marker
              key={h.locId}
              position={[Number(h.lat), Number(h.lng)]}
              icon={icon}
              {...{ locId: h.locId }}
            >
              <Popup>
                <HotspotPopup
                  h={h}
                  visited={visited}
                  userStats={userStatsByLoc?.get(h.locId)}
                  targetMode={targetMode}
                  targetSpecies={targetSpecies}
                  hasSpeciesHere={hasSpeciesHere}
                  isTarget={isTarget}
                />
              </Popup>
            </Marker>
          );
        })}
      </>
    ),
    [hotspots, visitedHotspots, userStatsByLoc, targetMode, targetSpecies, targetLocIds, speciesLocIds]
  );
}

// Pans/zooms the map to fit `hotspots` whenever `flyKey` changes (provided
// `enabled` is true). We track the last key we actually flew to so that
// async data loads (hotspots arriving after the selection changed) still
// trigger a single fly once data is ready.
function FlyToBounds({
  hotspots,
  flyKey,
  enabled,
  fallbackBounds,
}: {
  hotspots: any[];
  flyKey: string;
  enabled: boolean;
  fallbackBounds?: { south: number; north: number; west: number; east: number } | null;
}) {
  const map = useMap();
  // Track both the key we last flew to AND whether the fly was "tight"
  // (hotspot-derived) or "loose" (country-fallback). This lets us upgrade
  // from a country fit to a hotspot fit when data arrives, but avoid
  // re-flying once we've already shown the tight bounds for this key.
  const lastFlownKey = useRef<string>('');
  const lastFlownTight = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;

    const hasHotspots = !!hotspots && hotspots.length > 0;
    const sameKey = flyKey === lastFlownKey.current;
    // Skip if we already flew tight for this key, or if we flew loose and
    // still don't have anything tighter to show.
    if (sameKey && (lastFlownTight.current || !hasHotspots)) return;

    // Prefer hotspot bounds; otherwise fly to the country-level fallback if one
    // was provided (e.g. user picked a country but no region yet).
    if (hasHotspots) {
      const lats: number[] = [];
      const lngs: number[] = [];
      for (const h of hotspots) {
        const lat = Number(h.lat);
        const lng = Number(h.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          lats.push(lat);
          lngs.push(lng);
        }
      }
      if (lats.length > 0) {
        const bounds = L.latLngBounds(
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        );
        map.flyToBounds(bounds, { padding: [40, 40], duration: 0.8, maxZoom: 13 });
        lastFlownKey.current = flyKey;
        lastFlownTight.current = true;
        return;
      }
    }

    if (fallbackBounds) {
      const bounds = L.latLngBounds(
        [fallbackBounds.south, fallbackBounds.west],
        [fallbackBounds.north, fallbackBounds.east]
      );
      map.flyToBounds(bounds, { padding: [40, 40], duration: 0.8, maxZoom: 13 });
      lastFlownKey.current = flyKey;
      lastFlownTight.current = false;
    }
  }, [flyKey, hotspots, enabled, map, fallbackBounds]);

  return null;
}

// Reports the map viewport (center, zoom, half-diagonal radius in km) to the
// parent after every pan/zoom. Drives the cross-border "viewport hotspots"
// fetch when the user is zoomed in past the clustering threshold.
export type Viewport = { lat: number; lng: number; zoom: number; radiusKm: number };

function ViewportReporter({ onChange }: { onChange?: (v: Viewport) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!onChange) return;
    const report = () => {
      const c = map.getCenter();
      // Center -> NE corner distance covers the whole visible area.
      const radiusKm = c.distanceTo(map.getBounds().getNorthEast()) / 1000;
      onChange({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), radiusKm });
    };
    report();
    map.on('moveend', report);
    map.on('zoomend', report);
    return () => {
      map.off('moveend', report);
      map.off('zoomend', report);
    };
  }, [map, onChange]);
  return null;
}

// Captures map clicks while the user is in "pick on map" mode.
function ClickCapture({ enabled, onPick }: { enabled: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Flies to a hotspot when a new `focus` is provided (nonce makes repeated
// clicks on the same item re-trigger the fly).
function FocusOnHotspot({ focus }: { focus: { lat: number; lng: number; nonce: number } | null }) {
  const map = useMap();
  const lastNonce = useRef<number>(0);
  useEffect(() => {
    if (!focus) return;
    if (focus.nonce === lastNonce.current) return;
    lastNonce.current = focus.nonce;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 14), { duration: 0.7 });
  }, [focus, map]);
  return null;
}

type Props = {
  hotspots?: any[];
  visitedHotspots?: Set<string>;
  userStatsByLoc?: Map<string, { speciesCount: number; lastVisit: string }>;
  flyToBoundsKey?: string;
  flyToEnabled?: boolean;
  searchPoint?: { lat: number; lng: number } | null;
  isPickingOnMap?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  focusHotspot?: { locId: string; lat: number; lng: number; nonce: number } | null;
  targetMode?: boolean;
  targetSpecies?: string;
  targetLocIds?: Set<string>;
  speciesLocIds?: Set<string>;
  fallbackBounds?: { south: number; north: number; west: number; east: number } | null;
  stadiaKey?: string;
  // Cross-border hotspots for the current viewport (already deduped against
  // `hotspots` by the parent). Rendered as markers but excluded from
  // FlyToBounds so they never affect auto-panning.
  extraHotspots?: any[];
  onViewportChange?: (v: Viewport) => void;
};

export default function HotspotMap({
  hotspots = [],
  visitedHotspots = new Set(),
  userStatsByLoc,
  flyToBoundsKey = '',
  flyToEnabled = true,
  searchPoint = null,
  isPickingOnMap = false,
  onMapClick = () => {},
  focusHotspot = null,
  targetMode = false,
  targetSpecies = '',
  targetLocIds = new Set(),
  speciesLocIds = new Set(),
  fallbackBounds = null,
  stadiaKey = '',
  extraHotspots = [],
  onViewportChange,
}: Props) {
  // Region hotspots + viewport extras for marker rendering. FlyToBounds
  // deliberately keeps only the region hotspots.
  const renderHotspots = useMemo(
    () => (extraHotspots.length > 0 ? [...hotspots, ...extraHotspots] : hotspots),
    [hotspots, extraHotspots]
  );
  // Pick the tile layer. Stadia Maps gives English-everywhere labels via the
  // `&lang=en` query param; fall back to plain OSM (local-language labels)
  // when no key is provided.
  const tileUrl = stadiaKey
    ? `https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key=${encodeURIComponent(stadiaKey)}&lang=en`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution = stadiaKey
    ? '&copy; <a href="https://www.stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; OpenStreetMap'
    : '&copy; OpenStreetMap';
  return (
    <MapContainer
      center={[-35.28, 149.13]}
      zoom={6}
      style={{ height: '100%', width: '100%' }}
      className={isPickingOnMap ? 'picking-on-map' : ''}
      // Disable the default top-left zoom buttons; we render our own in the
      // top-right so they don't collide with the mobile sidebar toggle.
      zoomControl={false}
    >
      <ZoomControl position="topright" />

      {/* key forces Leaflet to swap the tile source when the user adds or
          removes their Stadia key — otherwise the URL change isn't picked up. */}
      <TileLayer
        key={stadiaKey ? 'stadia' : 'osm'}
        attribution={tileAttribution}
        url={tileUrl}
      />

      <MarkerClusterGroup
        // key forces a fresh cluster group when target state changes, so the
        // cluster icons recompute their target/visited/partial colouring.
        key={`cluster-${targetMode ? 'target' : 'normal'}-${targetSpecies}`}
        chunkedLoading
        chunkInterval={50}
        chunkDelay={20}
        removeOutsideVisibleBounds
        disableClusteringAtZoom={CLUSTER_OFF_ZOOM}
        iconCreateFunction={createClusterCustomIcon}
      >
        <AllMarkers
          hotspots={renderHotspots}
          visitedHotspots={visitedHotspots}
          userStatsByLoc={userStatsByLoc}
          targetMode={targetMode}
          targetSpecies={targetSpecies}
          targetLocIds={targetLocIds}
          speciesLocIds={speciesLocIds}
        />
      </MarkerClusterGroup>

      <FlyToBounds
        hotspots={hotspots}
        flyKey={flyToBoundsKey}
        enabled={flyToEnabled}
        fallbackBounds={fallbackBounds}
      />

      <ViewportReporter onChange={onViewportChange} />

      <ClickCapture enabled={isPickingOnMap} onPick={onMapClick} />

      <FocusOnHotspot focus={focusHotspot} />

      {searchPoint && (
        <Marker
          position={[searchPoint.lat, searchPoint.lng]}
          icon={searchPointIcon}
          interactive={false}
        />
      )}
    </MapContainer>
  );
}