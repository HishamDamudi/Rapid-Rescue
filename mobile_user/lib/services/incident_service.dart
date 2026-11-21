import 'package:connectivity_plus/connectivity_plus.dart';
import 'api_client.dart';
import 'offline_queue_service.dart';
import '../models/incident.dart';

class IncidentService {
  final _dio = ApiClient().dio;

  Future<Incident?> createIncident({
    required String type,
    required double lat,
    required double lng,
    String description = '',
    String triggerSource = 'manual',
    Map<String, dynamic>? sensorData,
  }) async {
    final payload = {
      'type': type, 'latitude': lat, 'longitude': lng,
      'description': description, 'triggerSource': triggerSource,
      if (sensorData != null) 'sensorData': sensorData,
    };

    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) {
      await OfflineQueueService.enqueue({'type': 'incident', 'payload': payload});
      return null; // queued, will sync later
    }

    try {
      final res = await _dio.post('/incidents', data: payload);
      return Incident.fromJson(res.data['incident']);
    } catch (_) {
      await OfflineQueueService.enqueue({'type': 'incident', 'payload': payload});
      return null;
    }
  }

  Future<List<Incident>> getMyIncidents() async {
    final res = await _dio.get('/incidents');
    return (res.data['data'] as List).map((e) => Incident.fromJson(e)).toList();
  }

  Future<List<Incident>> getActiveIncidents() async {
    final res = await _dio.get('/incidents', queryParameters: {'status': 'reported'});
    return (res.data['data'] as List).map((e) => Incident.fromJson(e)).toList();
  }

  Future<void> updateStatus(String id, String status, {String? note}) async {
    await _dio.patch('/incidents/$id/status', data: {'status': status, 'note': note});
  }

  Future<void> verify(String id, bool verified, {String? note}) async {
    await _dio.patch('/incidents/$id/verify', data: {'verified': verified, 'note': note});
  }
}
