import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user.dart';
import 'api_client.dart';
import '../core/constants.dart';

class AuthException implements Exception {
  final String message;
  AuthException(this.message);
  @override
  String toString() => message;
}

class AuthService {
  final _dio = ApiClient().dio;

  // Turns any Dio failure into a readable message (server message > network hint)
  AuthException _err(Object e) {
    if (e is DioException) {
      final m = e.response?.data is Map ? e.response?.data['message'] : null;
      if (m != null) return AuthException(m.toString());
      if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout) {
        return AuthException('Cannot reach server (${AppConfig.apiBase}). Tap Server and set your PC IP.');
      }
    }
    return AuthException('Something went wrong. Try again.');
  }

  Future<AppUser> login(String phone, String password) async {
    try {
      final r = await _dio.post('/auth/login', data: {'phone': phone, 'password': password});
      return _save(r.data);
    } catch (e) { throw _err(e); }
  }

  // Registered ONCE; backend returns a token so the user is logged in immediately and stays logged in.
  Future<AppUser> register(Map<String, dynamic> body) async {
    try {
      final r = await _dio.post('/auth/register', data: body);
      return _save(r.data);
    } catch (e) { throw _err(e); }
  }

  Future<AppUser> _save(Map<String, dynamic> d) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('accessToken', d['token']);
    return AppUser.fromJson(d['user']);
  }

  // Returns (user, sessionExpired). Offline start keeps the user signed in using cached profile.
  Future<AppUser?> me() async {
    try {
      final r = await _dio.get('/auth/me');
      return AppUser.fromJson(r.data['user']);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) { await logout(); return null; }
      rethrow;
    }
  }

  Future<void> updateProfile(Map<String, dynamic> body) async {
    try { await _dio.patch('/auth/me', data: body); } catch (e) { throw _err(e); }
  }

  Future<void> changePassword(String oldPw, String newPw) async {
    try { await _dio.patch('/auth/password', data: {'oldPassword': oldPw, 'newPassword': newPw}); } catch (e) { throw _err(e); }
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('accessToken');
  }

  Future<bool> isLoggedIn() async => (await SharedPreferences.getInstance()).getString('accessToken') != null;
}
