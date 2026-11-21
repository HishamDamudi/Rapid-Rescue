import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect } from 'react';

// Colored dot icons (no external image assets needed)
const dot = (color) => L.divIcon({
  className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>`,
  iconSize: [16, 16], iconAnchor: [8, 8],
});
export const icons = {
  incident: dot('#D32F2F'), hospital: dot('#1565C0'), police: dot('#1B5E20'),
  ambulance: dot('#FF9800'), user: dot('#90CAF9'),
};

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, map.getZoom() < 13 ? 13 : map.getZoom()); }, [center?.[0], center?.[1]]);
  return null;
}

export default function LiveMap({ center = [19.076, 72.8777], zoom = 12, markers = [], route, children }) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
      <Recenter center={center} />
      {markers.map((m, i) => (
        <Marker key={i} position={[m.lat, m.lng]} icon={icons[m.type] || icons.incident}>
          <Popup>{m.label}</Popup>
        </Marker>
      ))}
      {route && <Polyline positions={route} pathOptions={{ color: '#D32F2F', weight: 4, dashArray: '6,6' }} />}
      {children}
    </MapContainer>
  );
}
