import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix missing marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// 🧠 Custom cluster colouring
function createClusterCustomIcon(cluster: any, visitedHotspots: Set<string>) {
  const markers = cluster.getAllChildMarkers();

  let visitedCount = 0;

  markers.forEach((m: any) => {
    const locId = m.options.locId;
    if (visitedHotspots.has(locId)) visitedCount++;
  });

  let color = 'red';

  if (visitedCount === markers.length) color = 'green';
  else if (visitedCount > 0) color = 'blue';

  return L.divIcon({
    html: `<div style="
      background:${color};
      border-radius:50%;
      width:32px;
      height:32px;
      display:flex;
      align-items:center;
      justify-content:center;
      color:white;
      font-weight:bold;
    ">${markers.length}</div>`,
    className: 'custom-cluster',
    iconSize: L.point(32, 32, true),
  });
}

// 🧠 Only render visible markers
function VisibleMarkers({ hotspots, visitedHotspots }: any) {
  const map = useMap();
  const bounds = map.getBounds();

  const visible = hotspots.filter((h: any) =>
    bounds.contains([h.lat, h.lng])
  );

  return (
    <>
      {visible.map((h: any) => {
        const visited = visitedHotspots.has(h.locId);

        return (
          <Marker
            key={h.locId}
            position={[Number(h.lat), Number(h.lng)]}
            icon={visited ? greenIcon : redIcon}
            locId={h.locId}
          >
            <Popup>
              <strong>{h.locName}</strong><br />
              {visited ? "✅ Visited" : "❌ Not visited"}
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

type Props = {
  hotspots?: any[];
  visitedHotspots?: Set<string>;
};

export default function HotspotMap({ hotspots = [], visitedHotspots = new Set() }: Props) {
  return (
    <MapContainer
      center={[-35.28, 149.13]}
      zoom={6}
      style={{ height: '500px', width: '100%', marginTop: '20px' }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MarkerClusterGroup
        chunkedLoading
        disableClusteringAtZoom={12}
        iconCreateFunction={(cluster) =>
          createClusterCustomIcon(cluster, visitedHotspots)
        }
      >
        <VisibleMarkers
          hotspots={hotspots}
          visitedHotspots={visitedHotspots}
        />
      </MarkerClusterGroup>
    </MapContainer>
  );
}