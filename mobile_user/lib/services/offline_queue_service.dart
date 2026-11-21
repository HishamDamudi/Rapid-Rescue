import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'api_client.dart';

/// Persists incident reports locally when offline, auto-syncs on reconnect.
class OfflineQueueService {
  static const _key = 'offline_queue';

  static Future<void> enqueue(Map<String, dynamic> payload) async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_key) ?? [];
    payload['localId'] = DateTime.now().millisecondsSinceEpoch.toString();
    list.add(jsonEncode(payload));
    await prefs.setStringList(_key, list);
  }

  static Future<int> pendingCount() async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_key) ?? []).length;
  }

  static Future<void> trySync() async {
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) return;

    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_key) ?? [];
    if (list.isEmpty) return;

    final queue = list.map((s) => jsonDecode(s)).toList();
    try {
      await ApiClient().dio.post('/incidents/sync/offline', data: {'queue': queue});
      await prefs.setStringList(_key, []);
    } catch (_) {
      // stay queued, retry later
    }
  }

  static void watchConnectivity() {
    Connectivity().onConnectivityChanged.listen((status) {
      if (!status.contains(ConnectivityResult.none)) trySync();
    });
  }
}
