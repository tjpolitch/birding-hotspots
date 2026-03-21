import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix missing marker icons (Vite issue)
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

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type Props = {
  hotspots: any[];
  visitedHotspots: Set<string>;
};

export default function Map({ hotspots, visitedHotspots }: Props) {
  console.log("Hotspots in map:", hotspots.length); // 👈 debug

  return (
    <MapContainer
      center={[-35.28, 149.13]}
      zoom={10}
      style={{ height: '500px', width: '100%', marginTop: '20px' }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {hotspots.map((h) => {
        console.log("Hotspot:", h);

        const visited = visitedHotspots.has(h.locId);

        return (
          <Marker
  key={h.locId}
  position={[Number(h.lat), Number(h.lng)]}
  icon={visitedHotspots.has(h.locId) ? greenIcon : redIcon}
>
            <Popup>
              <strong>{h.locName}</strong><br />
              {visited ? "✅ Visited" : "❌ Not visited"}
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}