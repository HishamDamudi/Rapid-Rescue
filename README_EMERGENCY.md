# Emergency workflow upgrade

This is an **upgrade of the existing RapidRescue project** (same backend, same Flutter apps, same web app).
Nothing was deleted and no existing route was renamed. 24 existing files were edited and 11 were added;
the list is at the bottom.

## What happens now when a patient raises an SOS

```
Patient taps SOS (or a sensor fires)
  │
  ├─ relatives notified immediately            (existing relatives system + Socket.IO inbox; no Firebase for the new events)
  ├─ server snapshots the patient's medical profile (blood group, allergies, conditions, notes, contacts)
  │
  ├─ AMBULANCE   nearest *available* ambulance with a fresh GPS fix is reserved atomically → its driver app gets the call
  ├─ POLICE      nearest station identified → only that station's officers are alerted (no medical data)
  └─ HOSPITAL    suitable hospitals ranked (accepting + emergency-capable + free beds, nearer/roomier first)
                 → asked ONE AT A TIME: accept → medical details released to that hospital only
                                         decline / 90 s timeout → next hospital
                                         nobody accepts → dispatcher is alerted to choose one
  │
  └─ relatives are told: ambulance allocated · hospital confirmed (name, address, phone) · ambulance en route ·
     ARRIVED · on the way to hospital · patient reached hospital · resolved/cancelled
     relatives can ACKNOWLEDGE; the patient and the command centre see who has
```

**Sensor-triggered SOS** (gyro / free-fall) waits `AUTO_TRIGGER_GRACE_SEC` (default 20 s) before dispatching, and the patient's
tracking screen shows a countdown and an **"I'm safe — cancel alert"** button. Manual SOS dispatches immediately.
Your sensor thresholds are still marked as *testing values* in `sensor_service.dart`; because a trigger now dispatches real
vehicles, tune them before any real use.

## Who sees what

| Viewer | Sees |
|---|---|
| Patient | everything about their own emergency |
| Relative (accepted) | status, live ambulance position + ETA, hospital details, timeline, who acknowledged. **No medical details** |
| Admin / dispatcher | full operational picture (as before) |
| Hospital staff | *Before accepting:* only type, severity, distance, ETA. *After accepting:* name, phone, location, blood group, allergies, conditions, notes, emergency contacts. Access ends if the alert is cancelled |
| Police officer | location, contact, status of emergencies nearest *their* station. **Never medical details.** Can acknowledge and dispatch their own station's vans |
| Ambulance crew | what they need to treat the patient, including medical details |
| Police van | location + contact only |

All of this is enforced in one place (`backend/src/services/IncidentView.ts` + `IncidentAccess.ts`). Socket events carry only
ids; each client re-fetches its own filtered view over REST.

## Demo logins added to the seed (`npm run seed`)

| Role | Login | Password |
|---|---|---|
| Hospital staff → Sarvodaya | mohammad.d@somaiya.edu | Hospital@123 |
| Hospital staff → Rajawadi | rajawadi.staff@rapidrescue.app | Hospital@123 |
| Police officer → Ghatkopar station | police.ghatkopar@rapidrescue.app | Police@123 |
| Ambulance (Ghatkopar) / police van | AMB-003 / POL-003 | amb12345 / pol12345 |

Hospital and police staff are now **linked to a facility** (`associatedHospital` / `associatedPoliceStation`);
that link decides which requests they receive. An ambulance is only auto-allocated while its driver app is open and
reporting GPS (`VEHICLE_LOCATION_STALE_MIN`, default 10 min), so log in to the driver app first when demoing.

## New API (existing routes unchanged)

| Route | Who | Purpose |
|---|---|---|
| `GET /api/v1/emergency/active` | citizen | my emergency + my relatives' emergencies in progress |
| `GET /api/v1/emergency/:id` | patient, relative, hospital, police, staff | role-filtered tracking view |
| `POST /emergency/:id/acknowledge` | relative | "I've seen this" (+ optional note) |
| `POST /emergency/:id/cancel` | patient | "I'm safe" (only before responders are on scene) |
| `POST /emergency/:id/hospital/accept` · `/reject` | hospital staff | answer the request |
| `POST /emergency/:id/police/acknowledge` · `/dispatch` | police staff | acknowledge; send one of *their station's* vans |
| `GET /emergency/police/vans` | police staff | own station's vans |
| `PATCH /incidents/:id/cancel` | admin / dispatcher | **Cancel alert** — frees ambulance/van, withdraws hospital requests, tells the family |

New Socket.IO events: `emergency:update`, `emergency:vehicle` (live ambulance GPS), `emergency:attention` (dispatcher must act),
`hospital:offer`, `police:alert`, `incident:cancelled`. Rooms: `hospital_<id>`, `police_<id>`, `incident_<id>`.

## Configuration (all optional, in `backend/.env`)

`AUTO_TRIGGER_GRACE_SEC=20` · `AMBULANCE_MAX_KM=25` · `VEHICLE_LOCATION_STALE_MIN=10` · `POLICE_RADIUS_KM=20` ·
`HOSPITAL_OFFER_TIMEOUT_SEC=90` · `HOSPITAL_OFFER_COUNT=3` · `AMBULANCE_SEARCH_GIVE_UP_MIN=15`

## Existing behaviour I changed (and why)

These were necessary for the requirements to be safe; each is covered by a test.

1. **`GET /incidents`, `GET /incidents/:id`** — previously returned every incident to *any* logged-in user. Now scoped by role (a citizen sees only their own).
2. **`PATCH /incidents/:id/status`** — previously open to any logged-in user, including citizens. Now staff only; hospital staff only for cases they accepted.
3. **Socket rooms** — every user socket, including citizens, used to join `command_center` and receive every incident. Now admin/dispatcher only; hospital/police staff get their own rooms. `join_incident` is now authorised (was open to anyone).
4. **SOS medical data** — the app never sent it, so incidents stored none. It is now snapshotted server-side from the patient's profile (never trusted from the client).
5. **Vehicle controller** — a police van no longer overwrites the incident's overall status; vehicles other than ambulances no longer receive medical data; an ambulance finishing a hospital run now moves the incident to *hospital arrived* (it used to stay "transporting" forever).
6. **False alarm** (`verify` with `verified:false`) now also releases an already-dispatched vehicle.
7. **Citizen home screen** — SOS no longer falls back to a hard-coded Mumbai city-centre coordinate when GPS has no fix (that would now send an ambulance to the wrong place). It uses the live fix, tries for one briefly, and otherwise tells the user.
8. `SocketService` (existed, unused) now reuses a single connection and is used by `PushService` and the tracking screen.

## Things I noticed but did **not** change

* **Offline SOS never syncs**: `offline_queue_service.dart` posts to `/incidents/sync/offline`, which does not exist on the backend.
* `GET /vehicles` is readable by any logged-in user (including citizens), exposing fleet positions.
* `backend/firebase-service-account.json` (a live private key) was inside the zip you uploaded. Treat it as exposed and rotate it in the Firebase console.
* Hospital bed counts are not decremented on acceptance.
* ETAs shown to families are planning estimates (straight-line × 1.4 at 30 km/h); the driver apps still do real routing.
* The earlier "GPS accuracy" field from a previous iteration is not in this codebase; the "Cancel alert" button is (see above).

## Notifications and Firebase

New emergency notifications are stored in the existing inbox and pushed over Socket.IO only (`notifyUser(..., { fcm:false })`).
The original SOS alert still uses Firebase when configured, exactly as before. Because Socket.IO needs the app to be running,
a relative whose app is fully closed sees new family updates the next time it opens (the inbox + Home banner load immediately).

## Files

**Added:** `backend/src/{models/HospitalOffer.ts, services/{DispatchService,EmergencyService,IncidentAccess,IncidentView,geo}.ts, controllers/emergency.controller.ts, routes/emergency.routes.ts}`,
`mobile_user/lib/{services/emergency_service.dart, screens/citizen/emergency_screen.dart}`, `web/src/pages/PolicePortal.jsx`.

**Modified:** `backend/{.env.example, scripts/seed.ts, src/{app,server}.ts, src/controllers/{auth,incident,vehicle}.controller.ts, src/models/{Incident,User,index}.ts, src/routes/incident.routes.ts, src/services/NotificationService.ts, src/sockets/{events,index}.ts}`,
`mobile_user/lib/{screens/citizen/{home_screen,relatives_screen}.dart, services/{push_service,socket_service}.dart}`, `mobile_driver/lib/home_page.dart`,
`web/src/{App.jsx, pages/{CommandCenter,DriverPortal,HospitalPortal,Login}.jsx}`.
