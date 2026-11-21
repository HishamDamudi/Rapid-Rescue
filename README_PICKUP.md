# Automatic pickup, nearest hospital and OT-ready

**Flow**
1. Ambulance drives to the patient. The driver app streams GPS every ~3 s (foreground service, so it keeps working while Google Maps is open) and shows the live distance to the patient.
2. Server (`backend/src/services/ArrivalService.ts`): when the ambulance is within **10 m** of the patient on 2 consecutive good GPS fixes (accuracy <= 25 m) -> status **on the way to hospital** (`transporting`), timeline "reached the patient" + "picked up".
3. Nearest hospital is **allocated automatically** (nearest that is accepting + emergency-capable + has free beds; falls back to nearest overall). A hospital that already accepted earlier is kept. Patient medical details are shared with that hospital only.
4. The hospital portal shows **PATIENT ON THE WAY + ETA**, a **KEEP AN OT READY** tag and an **OT is ready** button. Pressing it tells the driver, the family and the timeline.
5. The driver app switches to **Directions to hospital** (opened automatically in Google Maps, live distance, OT status).
6. Patient app: the red SOS alert is replaced by a green **On the way to hospital - <name>** card; cancel is no longer offered. Family gets "ambulance arrived" and "on the way to <hospital>".
7. Within 50 m of the hospital the status becomes **hospital_arrived** automatically; the crew taps **Complete** to hand over.

**Manual fallback**: the driver's **Patient picked up** button runs the same routine if GPS cannot confirm 10 m.

Tunables (backend `.env`): `ARRIVAL_RADIUS_M`, `HOSPITAL_ARRIVAL_RADIUS_M`, `ARRIVAL_MAX_ACCURACY_M`, `ARRIVAL_CONFIRM_FIXES`.

Notes: distances are straight-line (haversine); turn-by-turn comes from Google Maps / OSRM. Seeded hospitals need `location` (they have it) and `availableEmergencyBeds`.
Driver app: on first start allow location **and notifications** (Android 13+) so the background location service can run.

## Hospital directory and dashboards
- Citizen app > Hospitals: live list from `GET /directory/hospitals/nearby?lat&lng` - re-ranked whenever you move 100 m and refreshed every 30 s. Tap a hospital for its dashboard (beds, OT free, ambulances coming, specialties, call, directions). Falls back to the built-in list when offline.
- Each hospital has its OWN web dashboard: log in to the web portal as that hospital's staff (hospital = account, not your location). Password for all: `Hospital@123`
  `lilavati.staff@` · `kem.staff@` · `hinduja.staff@` · `bombay.staff@` · `nanavati.staff@` · `kokilaben.staff@` · `rajawadi.staff@` · `mohammad.d@somaiya.edu` (Sarvodaya) - `@rapidrescue.app` except Sarvodaya.
- The dashboard has a **live capacity** panel (emergency beds, OT free, accepting patients, specialties). Those numbers feed the citizen list and the auto-allocation ranking (a serious case ranks a hospital lower when it has no OT free).
- `POST /directory/hospitals` is now admin-only (it was open to anyone). Re-run `npm run seed`.
