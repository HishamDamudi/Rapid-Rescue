# RapidRescue - separate apps

| App | Folder | Login |
|---|---|---|
| Citizen | `mobile_user` | Register ONCE (name, phone, address, medical). Then stays logged in. Re-login = phone + password (default password = phone number) |
| Driver (ambulance / police van) | `mobile_driver` | Username + password issued by admin |
| Admin / hospital / dispatcher | `web` | email + password |

## Run
```
cd backend && npm install && npm run seed && npm run dev
cd mobile_user   && flutter pub get && flutter run --dart-define=API_HOST=<PC_LAN_IP>
cd mobile_driver && flutter pub get && flutter run --dart-define=API_HOST=<PC_LAN_IP>
```
Emulator: omit `--dart-define` (uses 10.0.2.2). Real phone: phone and PC on same Wi-Fi; allow port 5000 in Windows Firewall.
USB alternative: `adb reverse tcp:5000 tcp:5000` then `--dart-define=API_HOST=127.0.0.1`.

## Demo
- Citizen: 9999999999 / 9999999999
- Driver: AMB-001 / amb12345, POL-001 / pol12345
- Admin (web): hishamdamudi123@gmail.com / Admin@123

Note: drop the old `users` collection (or run seed against a fresh DB) - email/phone indexes changed.
SMS (Twilio) removed. Wrong password 5x locks the account 15 min.

**Server address:** tap the `Server` button on the login/register screen, enter your PC IP, press Test, then Save. No rebuild needed. Health check URL: `http://<PC-IP>:5000/health`.
