import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'config.dart';

class ApiError implements Exception {
  final String message; final bool unauthorized;
  ApiError(this.message, {this.unauthorized = false});
  @override
  String toString() => message;
}

class Api {
  static final dio = Dio(BaseOptions(baseUrl: AppConfig.apiBase, connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 15)))
    ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      o.baseUrl = AppConfig.apiBase;
      final t = (await SharedPreferences.getInstance()).getString('driverToken');
      if (t != null) o.headers['Authorization'] = 'Bearer $t';
      h.next(o);
    }));

  static ApiError _err(Object e) {
    if (e is DioException) {
      final m = e.response?.data is Map ? e.response?.data['message'] : null;
      if (m != null) return ApiError(m.toString(), unauthorized: e.response?.statusCode == 401);
      if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout) {
        return ApiError('Cannot reach server (${AppConfig.apiBase}). Tap Server on the login screen and set your PC IP.');
      }
      if (e.response?.statusCode == 401) return ApiError('Session expired', unauthorized: true);
    }
    return ApiError('Something went wrong. Try again.');
  }

  static Future<bool> hasSession() async => (await SharedPreferences.getInstance()).getString('driverToken') != null;
  static Future<String?> token() async => (await SharedPreferences.getInstance()).getString('driverToken');

  static Future<Map<String, dynamic>> login(String username, String password) async {
    try {
      final r = await dio.post('/auth/vehicle-login', data: {'username': username.trim(), 'password': password});
      final p = await SharedPreferences.getInstance();
      await p.setString('driverToken', r.data['token']);
      return r.data['vehicle'];
    } catch (e) { throw _err(e); }
  }

  static Future<void> logout() async => (await SharedPreferences.getInstance()).remove('driverToken');

  // { vehicle, incident }
  static Future<Map<String, dynamic>> assignment() async {
    try { return (await dio.get('/vehicles/me/assignment')).data; } catch (e) { throw _err(e); }
  }

  static Future<void> setStatus(String status) async {
    try { await dio.patch('/vehicles/me/status', data: {'status': status}); } catch (e) { throw _err(e); }
  }

  static Future<void> changePassword(String oldPw, String newPw) async {
    try { await dio.patch('/auth/vehicle-password', data: {'oldPassword': oldPw, 'newPassword': newPw}); } catch (e) { throw _err(e); }
  }
}
