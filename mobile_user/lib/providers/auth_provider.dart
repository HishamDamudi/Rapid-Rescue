import 'package:flutter/foundation.dart';
import '../models/user.dart';
import '../services/auth_service.dart';
import '../services/push_service.dart';

class AuthProvider extends ChangeNotifier {
  final _service = AuthService();
  AppUser? user;
  bool loading = true;

  Future<void> init() async {
    if (await _service.isLoggedIn()) {
      try { user = await _service.me(); } catch (_) { /* offline: stay on splash-less retry below */ }
      // token valid but server unreachable -> keep a minimal session so SOS still works offline
      if (user == null && await _service.isLoggedIn()) {
        user = AppUser(id: '', uniqueId: '', name: 'Offline', email: '');
      }
    }
    loading = false;
    notifyListeners();
    if (user != null) PushService.onLogin();
  }

  // Each returns null on success, or an error message for the UI.
  Future<String?> login(String phone, String password) async {
    final err = await _run(() async => user = await _service.login(phone, password));
    if (err == null) PushService.onLogin(); // register this phone for relative alerts
    return err;
  }
  Future<String?> register(Map<String, dynamic> body) async {
    final err = await _run(() async => user = await _service.register(body));
    if (err == null) PushService.onLogin();
    return err;
  }

  Future<String?> _run(Future<void> Function() f) async {
    try { await f(); notifyListeners(); return null; } on AuthException catch (e) { return e.message; }
  }

  Future<String?> updateProfile(Map<String, dynamic> body) => _run(() async {
    await _service.updateProfile(body);
    user = await _service.me();
  });

  Future<String?> changePassword(String o, String n) => _run(() => _service.changePassword(o, n));

  Future<void> logout() async {
    await PushService.onLogout(); // while the token is still valid
    await _service.logout();
    user = null;
    notifyListeners();
  }
}
