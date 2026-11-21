import 'package:dio/dio.dart';
import 'api_client.dart';
import 'relative_service.dart' show RelError;

class ActiveEmergencies {
  /// My own emergencies still in progress.
  final List<Map<String, dynamic>> mine;
  /// Emergencies of my accepted relatives still in progress.
  final List<Map<String, dynamic>> relatives;
  ActiveEmergencies(this.mine, this.relatives);
  bool get isEmpty => mine.isEmpty && relatives.isEmpty;
}

/// Talks to /emergency/* — tracking, family acknowledgement and "I'm safe".
/// The server filters every response by who is asking (patient / relative), so the
/// app never receives anything it isn't entitled to see.
class EmergencyService {
  final _dio = ApiClient().dio;

  RelError _err(Object e) {
    if (e is DioException) {
      final d = e.response?.data;
      if (d is Map && d['message'] != null) return RelError(d['message'].toString());
      if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout) {
        return RelError('Cannot reach the server. Check your connection.');
      }
    }
    return RelError('Something went wrong. Try again.');
  }

  List<Map<String, dynamic>> _list(dynamic l) =>
      (l as List? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  Future<Map<String, dynamic>> track(String id) async {
    try {
      final d = (await _dio.get('/emergency/$id')).data;
      return Map<String, dynamic>.from(d['incident'] as Map);
    } catch (e) { throw _err(e); }
  }

  Future<ActiveEmergencies> active() async {
    try {
      final d = (await _dio.get('/emergency/active')).data;
      return ActiveEmergencies(_list(d['mine']), _list(d['relatives']));
    } catch (e) { throw _err(e); }
  }

  /// A relative confirms they have seen the alert.
  Future<Map<String, dynamic>> acknowledge(String id, {String? note}) async {
    try {
      final d = (await _dio.post('/emergency/$id/acknowledge', data: {if (note != null && note.isNotEmpty) 'note': note})).data;
      return Map<String, dynamic>.from(d['incident'] as Map);
    } catch (e) { throw _err(e); }
  }

  /// The patient says they are safe (false alarm / accidental trigger).
  Future<Map<String, dynamic>> cancel(String id, {String? reason}) async {
    try {
      final d = (await _dio.post('/emergency/$id/cancel', data: {if (reason != null && reason.isNotEmpty) 'reason': reason})).data;
      return Map<String, dynamic>.from(d['incident'] as Map);
    } catch (e) { throw _err(e); }
  }
}
