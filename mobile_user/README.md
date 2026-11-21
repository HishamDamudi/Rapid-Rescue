# 🚨 RapidRescue — Flutter (iOS + Android)

Cross-platform emergency SOS app: GPS + sensor auto-alerts, offline queue, QR
emergency ID, and role dashboards (citizen / admin / hospital / police). Talks
to the RapidRescue Node.js backend.

## Setup

```bash
flutter pub get

# point at your backend (edit lib/core/constants.dart)
#   Android emulator → http://10.0.2.2:5000/api/v1
#   iOS simulator    → http://localhost:5000/api/v1
#   physical device  → http://<your-lan-ip>:5000/api/v1

flutter run                # debug, either platform
flutter build apk          # Android release
flutter build ios          # iOS release (needs Xcode + signing)
```

## What's wired up

- **Auth** — email/password login+register, JWT stored via `shared_preferences`, role-based routing (`router_screen.dart`)
- **SOS** — hold-to-confirm button, sends GPS + trigger source to `/incidents`
- **Sensors** (`sensor_service.dart`) — gyroscope & accelerometer via `sensors_plus`; auto-fires SOS on violent rotation or free-fall. Ambient temperature has no stable Flutter API — wire a platform channel if your target device exposes one.
- **Offline queue** (`offline_queue_service.dart`) — incidents created with no connectivity are saved to `shared_preferences` and auto-synced via `connectivity_plus` once back online
- **Map** — `flutter_map` + OpenStreetMap tiles centered on Mumbai, hospital markers, live user location
- **QR emergency ID** — `qr_flutter` renders a scannable ID card; pair with `mobile_scanner` on the responder side
- **Dashboards** — Admin (all users + live alerts), Hospital (incoming patients), Police (active emergencies), each polling the backend REST API

## Folder map

```
lib/
  core/          constants + theme
  models/        User, Incident
  services/      api_client, auth, location, sensor, incident, offline_queue, socket
  providers/     AuthProvider (ChangeNotifier)
  widgets/       SOSButton, SensorMonitor, MumbaiMap
  screens/
    auth/        login, register
    citizen/     home, profile, qr, hospitals
    admin/       admin_dashboard
    hospital/    hospital_dashboard
    police/      police_dashboard
    router_screen.dart   → picks screen by role
  main.dart
android/ios/     platform manifests with location/camera/vibrate permissions
```

## Backend

This app expects the RapidRescue Node/Express/MongoDB API (separate repo)
running with routes under `/api/v1/...` — auth, incidents, admin, hospitals,
police, resources, directory. Update `AppConfig.apiBase` / `socketUrl` in
`lib/core/constants.dart` to match your deployment.

## Next steps you'll likely want

- Add `mobile_scanner`-based QR scan screen for responders
- Wire `socket_io_client` (already in `socket_service.dart`) into the dashboards for live push instead of manual refresh
- Add a platform channel for real ambient/body temperature if your hardware supports it
- App icons / splash screen (currently default Flutter assets)
