import 'api_client.dart';

/// Public hospital info (capacity numbers only - never patient data).
class HospitalDirectoryService {
  final _dio = ApiClient().dio;

  Future<List<Map<String, dynamic>>> nearby(double lat, double lng) async {
    final r = await _dio.get('/directory/hospitals/nearby', queryParameters: {'lat': lat, 'lng': lng, 'radiusKm': 30});
    return List<Map<String, dynamic>>.from(r.data['data'] as List);
  }

  Future<Map<String, dynamic>> detail(String id, {double? lat, double? lng}) async {
    final r = await _dio.get('/directory/hospitals/$id', queryParameters: {if (lat != null) 'lat': lat, if (lng != null) 'lng': lng});
    return Map<String, dynamic>.from(r.data['data'] as Map);
  }
}
