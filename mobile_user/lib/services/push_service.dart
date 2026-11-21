import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import '../screens/citizen/emergency_screen.dart';
import '../screens/citizen/relatives_screen.dart';
import 'api_client.dart';
import 'socket_service.dart';

/// Push notifications for relative alerts.
///
/// Needs android/app/google-services.json (see README_RELATIVES.md). Without it
/// Firebase can't start, push stays off, and everything else keeps working —
/// the Relatives screen just refreshes itself every few seconds instead.
///
/// With it, alerts arrive in the phone's notification tray even when the app
/// is closed (the system shows them, no app code has to be running).
class PushService {
  static final navigatorKey = GlobalKey<NavigatorState>();
  static final messengerKey = GlobalKey<ScaffoldMessengerState>();

  /// Unread in-app notifications (drives the badge on Home).
  static final unread = ValueNotifier<int>(0);
  /// Bumped whenever a push arrives while the app is open, so open screens reload.
  static final tick = ValueNotifier<int>(0);

  static bool _ready = false, _listening = false;
  static Object? _boundSocket;   // the socket our listeners are attached to (so they are attached once per connection)
  static StreamSubscription<String>? _refreshSub;

  static Future<void> init() async {
    try {
      await Firebase.initializeApp();
      _ready = true;
    } catch (e) {
      debugPrint('Push disabled (add android/app/google-services.json to enable): $e');
    }
  }

  /// Call after the user signs in / the app starts already signed in.
  static Future<void> onLogin() async {
    refreshUnread();
    _connectSocket();   // live family/emergency updates — works with or without Firebase
    if (!_ready) return;
    try {
      final fm = FirebaseMessaging.instance;
      await fm.requestPermission(alert: true, badge: true, sound: true); // Android 13+ asks here
      final token = await fm.getToken();
      if (token != null) await _send(token);
      _refreshSub ??= fm.onTokenRefresh.listen(_send);
      if (!_listening) {
        _listening = true;
        FirebaseMessaging.onMessage.listen(_foreground);
        FirebaseMessaging.onMessageOpenedApp.listen(_open);
        final first = await fm.getInitialMessage(); // app was closed and opened by tapping a push
        if (first != null) _open(first);
      }
    } catch (e) {
      debugPrint('Push setup failed: $e');
    }
  }

  /// Call BEFORE the login token is wiped, so this phone stops getting the old user's alerts.
  static Future<void> onLogout() async {
    try { await ApiClient().dio.delete('/notifications/token'); } catch (_) {}
    if (_ready) { try { await FirebaseMessaging.instance.deleteToken(); } catch (_) {} }
    SocketService.disconnect();
    _boundSocket = null;
    unread.value = 0;
  }

  static Future<void> _send(String token) async {
    try { await ApiClient().dio.post('/notifications/token', data: {'token': token}); } catch (_) {}
  }

  static Future<void> refreshUnread() async {
    try {
      final r = await ApiClient().dio.get('/notifications');
      unread.value = (r.data['unread'] ?? 0) as int;
    } catch (_) {}
  }

  /// Live updates over the app's Socket.IO connection. Emergency updates for relatives (ambulance allocated,
  /// hospital confirmed, arrival …) arrive here — deliberately NOT through Firebase.
  static Future<void> _connectSocket() async {
    try {
      final s = await SocketService.connect();
      if (identical(_boundSocket, s)) return;
      _boundSocket = s;
      s.on('notification:new', (data) {
        refreshUnread();
        tick.value++;                       // open screens (Relatives, Home banner) reload
        if (data is Map) _liveToast(Map<String, dynamic>.from(data));
      });
      s.on('emergency:update', (_) { tick.value++; });
    } catch (e) {
      debugPrint('Live updates unavailable: $e');
    }
  }

  static void _liveToast(Map<String, dynamic> n) {
    final type = '${n['type'] ?? ''}';
    // Firebase already shows SOS alerts when it is active; the socket covers SOS only when it is not.
    if (!type.startsWith('emergency_') && !(type == 'sos' && !_ready)) return;
    final d = n['data'];
    final id = d is Map ? '${d['emergencyId'] ?? ''}' : '';
    messengerKey.currentState?.showSnackBar(SnackBar(
      duration: const Duration(seconds: 8),
      backgroundColor: type == 'sos' ? const Color(0xFFB71C1C) : null,
      content: Text('${n['title'] ?? 'RapidRescue'}\n${n['body'] ?? ''}'),
      action: id.isEmpty ? null : SnackBarAction(label: 'TRACK', onPressed: () => openEmergency(id)),
    ));
  }

  /// Open the live tracking screen for an emergency (patient or relative).
  static void openEmergency(String id) {
    navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => EmergencyScreen(emergencyId: id)));
  }

  static void _foreground(RemoteMessage m) {
    refreshUnread();
    tick.value++;
    final n = m.notification;
    final sos = m.data['type'] == 'sos';
    messengerKey.currentState?.showSnackBar(SnackBar(
      duration: const Duration(seconds: 10),
      backgroundColor: sos ? const Color(0xFFB71C1C) : null,
      content: Text('${n?.title ?? 'RapidRescue'}\n${n?.body ?? ''}'),
      action: SnackBarAction(label: 'VIEW', onPressed: () => _open(m)),
    ));
  }

  static void _open(RemoteMessage m) {
    navigatorKey.currentState?.push(MaterialPageRoute(
        builder: (_) => RelativesScreen(initialTab: m.data['type'] == 'sos' ? 1 : 0)));
  }
}
