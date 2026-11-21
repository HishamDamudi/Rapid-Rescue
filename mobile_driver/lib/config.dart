import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Server address is editable INSIDE the app (saved on the phone), so no rebuild is needed.
class AppConfig {
  static String host = const String.fromEnvironment('API_HOST', defaultValue: '10.0.2.2');
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
  String? msg; bool ok = false, busy = false;
  await showDialog(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, set) => AlertDialog(
    backgroundColor: const Color(0xFF1A1A1F),
    title: const Text('Server address'),
    content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Enter your PC\'s Wi-Fi IP (run ipconfig), e.g. 192.168.1.23', style: TextStyle(fontSize: 12, color: Colors.grey)),
      const SizedBox(height: 10),
      TextField(controller: c, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Host / IP', prefixText: 'http://', suffixText: ':5000')),
      if (msg != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(msg!, style: TextStyle(color: ok ? Colors.greenAccent : Colors.redAccent, fontSize: 12))),
    ]),
    actions: [
      TextButton(onPressed: busy ? null : () async {
        set(() { busy = true; msg = 'Testing…'; });
        final h = c.text.trim();
        try {
          final r = await Dio(BaseOptions(connectTimeout: const Duration(seconds: 5), validateStatus: (_) => true)).get('http://$h:5000/health');
          ok = r.statusCode == 200; msg = ok ? 'Connected ✓' : 'Server answered ${r.statusCode}';
        } catch (_) { ok = false; msg = 'Cannot reach $h:5000 - same Wi-Fi? backend running? firewall?'; }
        set(() => busy = false);
      }, child: const Text('Test')),
      TextButton(onPressed: () async {
        final h = c.text.trim().replaceAll(RegExp(r'^https?://|:5000.*$|/.*$'), '');
        if (h.isNotEmpty) { AppConfig.host = h; (await SharedPreferences.getInstance()).setString('apiHost', h); }
        if (ctx.mounted) Navigator.pop(ctx);
      }, child: const Text('Save')),
    ],
  )));
}

Widget serverButton(BuildContext context, VoidCallback after) => TextButton.icon(
  onPressed: () async { await showServerDialog(context); after(); },
  icon: const Icon(Icons.dns, size: 16),
  label: Text('Server: ${AppConfig.host}', style: const TextStyle(fontSize: 11)));
