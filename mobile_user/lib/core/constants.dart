import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Server address is editable INSIDE the app (saved on the phone), so no rebuild is needed.
class AppConfig {
  static String host =
      const String.fromEnvironment('API_HOST', defaultValue: '10.0.2.2');
  static String get apiBase => 'http://$host:5000/api/v1';
  static String get socketUrl => 'http://$host:5000';

  static Future<void> load() async {
    final h = (await SharedPreferences.getInstance()).getString('apiHost');
    if (h != null && h.isNotEmpty) host = h;
  }
}

/// Dialog: enter PC IP, test connection, save.
Future<void> showServerDialog(BuildContext context) async {
  final c = TextEditingController(text: AppConfig.host);
  String? msg;
  bool ok = false, busy = false;
  await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
          builder: (ctx, set) => AlertDialog(
                backgroundColor: const Color(0xFF1A1A1F),
                title: const Text('Server address'),
                content: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                          'Enter your PC\'s Wi-Fi IP (run ipconfig), e.g. 192.168.1.23',
                          style: TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 10),
                      TextField(
                          controller: c,
                          keyboardType: TextInputType.url,
                          decoration: const InputDecoration(
                              labelText: 'Host / IP',
                              prefixText: 'http://',
                              suffixText: ':5000')),
                      if (msg != null)
                        Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Text(msg!,
                                style: TextStyle(
                                    color: ok
                                        ? Colors.greenAccent
                                        : Colors.redAccent,
                                    fontSize: 12))),
                    ]),
                actions: [
                  TextButton(
                      onPressed: busy
                          ? null
                          : () async {
                              set(() {
                                busy = true;
                                msg = 'Testing…';
                              });
                              final h = c.text.trim();
                              try {
                                final r = await Dio(BaseOptions(
                                    connectTimeout: const Duration(seconds: 5),
                                    validateStatus: (_) =>
                                        true)).get('http://$h:5000/health');
                                ok = r.statusCode == 200;
                                msg = ok
                                    ? 'Connected ✓'
                                    : 'Server answered ${r.statusCode}';
                              } catch (_) {
                                ok = false;
                                msg =
                                    'Cannot reach $h:5000 - same Wi-Fi? backend running? firewall?';
                              }
                              set(() => busy = false);
                            },
                      child: const Text('Test')),
                  TextButton(
                      onPressed: () async {
                        final h = c.text.trim().replaceAll(
                            RegExp(r'^https?://|:5000.*$|/.*$'), '');
                        if (h.isNotEmpty) {
                          AppConfig.host = h;
                          (await SharedPreferences.getInstance())
                              .setString('apiHost', h);
                        }
                        if (ctx.mounted) Navigator.pop(ctx);
                      },
                      child: const Text('Save')),
                ],
              )));
}

Widget serverButton(BuildContext context, VoidCallback after) =>
    TextButton.icon(
        onPressed: () async {
          await showServerDialog(context);
          after();
        },
        icon: const Icon(Icons.dns, size: 16),
        label: Text('Server: ${AppConfig.host}',
            style: const TextStyle(fontSize: 11)));

// ⚠️ gyroMagnitude / accelFreefall below are TESTING VALUES — deliberately
// very sensitive so you can trigger an auto-SOS just by shaking/tilting the
// phone a little on a desk, without needing a real fall. Dial these back up
// before real-world/production use (realistic value noted in each comment)
// — this sensitive a setting WILL false-trigger during normal handling
// (picking the phone up quickly, bumping a table, etc). Temperature values
// below are back to their realistic (non-test) settings.
class SensorThresholds {
  static const gyroMagnitude = 6.0; // realistic: 8.0 (was 15.0 originally)
  static const gyroSustainedMs = 200; // realistic: 500
  // Trigger fires when total acceleration drops BELOW this value (true
  // free-fall ≈ 0 m/s²). Higher = easier to trigger (less drop needed).
  static const accelFreefall = 3.0; // realistic: 4.0 (was 2.0 originally)
  static const accelFreefallMs = 200; // realistic: 250
  static const tempDeltaC = 8.0;
  static const tempWindowMs = 30000;
  // Device (battery) temperature above this is treated as a heat emergency —
  // e.g. phone left in a hot car / high ambient heat / fire proximity.
  static const tempHighC = 45.0;
  static const tempHighSustainedMs = 5000;
}

class Mumbai {
  static const lat = 19.0760;
  static const lng = 72.8777;
  static const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}

class Hospitals {
  static const list = [
    {
      'name': 'KEM Hospital',
      'lat': 19.0004,
      'lng': 72.8397,
      'phone': '+912224136051'
    },
    {
      'name': 'Hinduja Hospital',
      'lat': 19.0535,
      'lng': 72.8397,
      'phone': '+912224445000'
    },
    {
      'name': 'Lilavati Hospital',
      'lat': 19.0607,
      'lng': 72.8313,
      'phone': '+912226751000'
    },
    {
      'name': 'Bombay Hospital',
      'lat': 18.9392,
      'lng': 72.8353,
      'phone': '+912222067676'
    },
    {
      'name': 'Nanavati Hospital',
      'lat': 19.0893,
      'lng': 72.8396,
      'phone': '+912226182222'
    },
    {
      'name': 'Kokilaben Hospital',
      'lat': 19.1302,
      'lng': 72.8309,
      'phone': '+912230999999'
    },
  ];
}
