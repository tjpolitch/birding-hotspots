import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

// Dimmed "never visited" marker for target mode — pushes attention onto the
// amber target markers.
const mutedIcon = L.divIcon({
  className: 'hotspot-marker muted',
  html: '',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  popupAnchor: [0, -7],
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
}: {
  hotspots: any[];
  flyKey: string;
  enabled: boolean;
}) {
  const map = useMap();
  const lastFlownKey = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    if (flyKey === lastFlownKey.current) return;
    if (!hotspots || hotspots.length === 0) return;

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
    if (lats.length === 0) return;

    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
    map.flyToBounds(bounds, { padding: [40, 40], duration: 0.8, maxZoom: 13 });
    lastFlownKey.current = flyKey;
  }, [flyKey, hotspots, enabled, map]);

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
}: Props) {
  return (
    <MapContainer
      center={[-35.28, 149.13]}
      zoom={6}
      style={{ height: '100%', width: '100%' }}
      className={isPickingOnMap ? 'picking-on-map' : ''}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MarkerClusterGroup
        // key forces a fresh cluster group when target state changes, so the
        // cluster icons recompute their target/visited/partial colouring.
        key={`cluster-${targetMode ? 'target' : 'normal'}-${targetSpecies}`}
        chunkedLoading
        chunkInterval={50}
        chunkDelay={20}
        removeOutsideVisibleBounds
        disableClusteringAtZoom={12}
        iconCreateFunction={createClusterCustomIcon}
      >
        <AllMarkers
          hotspots={hotspots}
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
      />

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