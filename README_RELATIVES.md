# Relatives + push alerts

## How it works (in the app)
1. Every citizen has an **ID code** (e.g. `RR-000012`) — shown at the top of **Home → Relatives**.
2. Person A opens **Relatives**, types B's ID code, taps **Send request**.
3. B gets a notification, opens **Relatives → Requests for you**, taps ✔ **Accept** (or ✖ Reject).
4. Once accepted, the link works **both ways**: when either of them sends an SOS (button or
   auto fall/heat trigger) the other gets a notification with the name, phone and a
   **Open location / Call** button. Either side can remove the link any time.

Alerts are also saved in the **Alerts** tab, so nothing is lost if a push is missed.

## Phone notifications when the app is CLOSED (one-time Firebase setup, free)
Without this, everything above still works — requests/alerts just appear when the app is open
(the screen refreshes every 15 s). To get notifications in the phone's tray while the app is closed:

1. https://console.firebase.google.com → **Add project** (any name).
2. In the project → **Add app → Android**. Package name must be exactly `com.example.rapidrescue`.
   Download **google-services.json** and put it in `mobile_user/android/app/`.
3. Project settings → **Service accounts → Generate new private key**. Save the file as
   `backend/firebase-service-account.json`.
4. In `backend/.env` add:  `FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json`
5. `cd backend && npm install` (adds `firebase-admin`), then restart `npm run dev`.
   The log should say `Firebase push enabled`.
6. `cd mobile_user && flutter pub get && flutter run`. Allow notifications when asked (Android 13+).

Notes
- Test on a real phone (or an emulator image that includes Google Play).
- If you swipe the app away it still works. If you **Force stop** it in Android settings, Android
  blocks all notifications until you open the app again — that's an OS rule, not a bug.
- The same ID is used for a phone only by one account at a time; logging out stops that phone
  receiving the old account's alerts.
- If Gradle complains about the google-services plugin after you add the json, bump the version
  in `mobile_user/android/settings.gradle.kts` (`com.google.gms.google-services`) to the latest one.

## API added (all need the citizen login token)
- `GET /relatives` · `POST /relatives/request {uniqueId}` · `POST /relatives/:id/accept|reject` · `DELETE /relatives/:id`
- `GET /notifications` · `POST /notifications/read-all` · `POST|DELETE /notifications/token`
- `POST /incidents` now picks up the logged-in user (optional token) so their relatives can be alerted.
