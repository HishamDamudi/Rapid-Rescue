import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants.dart';

class ApiClient {
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;
  late Dio dio;

  ApiClient._internal() {
    dio = Dio(BaseOptions(baseUrl: AppConfig.apiBase, connectTimeout: const Duration(seconds: 10)));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (opts, handler) async {
      opts.baseUrl = AppConfig.apiBase; // picks up in-app server change instantly
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');
      if (token != null) opts.headers['Authorization'] = 'Bearer $token';
      handler.next(opts);
    }));
  }
}
