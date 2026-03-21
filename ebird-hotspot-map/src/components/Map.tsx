import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix missing marker icons (Vite issue)
delete (L.Icon.Default.prototype as any)._getIconUrl;

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
          <Marker key={h.locId} position={[Number(h.lat), Number(h.lng)]}>
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