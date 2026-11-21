import 'package:dio/dio.dart';
import 'api_client.dart';

class RelError implements Exception {
  final String message;
  RelError(this.message);
  @override
  String toString() => message;
}

class RelativeItem {
  final String id, status, name, uniqueId, phone;
  RelativeItem(this.id, this.status, this.name, this.uniqueId, this.phone);
  factory RelativeItem.fromJson(Map<String, dynamic> j) {
    final u = (j['user'] ?? {}) as Map;
    return RelativeItem('${j['id']}', '${j['status']}', '${u['name'] ?? ''}', '${u['uniqueId'] ?? ''}', '${u['phone'] ?? ''}');
  }
}

class RelativesData {
  final List<RelativeItem> accepted, incoming, outgoing;
  RelativesData(this.accepted, this.incoming, this.outgoing);
}

class AppNotification {
  final String id, title, body, type;
  final bool read;
  final Map<String, dynamic> data;
  final DateTime? createdAt;
  AppNotification(this.id, this.title, this.body, this.type, this.read, this.data, this.createdAt);
  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        '${j['_id']}', '${j['title'] ?? ''}', '${j['body'] ?? ''}', '${j['type'] ?? 'general'}',
        j['read'] == true, Map<String, dynamic>.from((j['data'] ?? {}) as Map),
        DateTime.tryParse('${j['createdAt']}')?.toLocal());
}

class RelativeService {
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

  List<RelativeItem> _items(dynamic l) => (l as List? ?? []).map((e) => RelativeItem.fromJson(Map<String, dynamic>.from(e))).toList();

  Future<RelativesData> list() async {
    try {
      final d = (await _dio.get('/relatives')).data;
      return RelativesData(_items(d['accepted']), _items(d['incoming']), _items(d['outgoing']));
    } catch (e) { throw _err(e); }
  }

  /// Returns the server's confirmation message ("Request sent to ...").
  Future<String> add(String uniqueId) async {
    try {
      final d = (await _dio.post('/relatives/request', data: {'uniqueId': uniqueId})).data;
      return '${d['message'] ?? 'Request sent'}';
    } catch (e) { throw _err(e); }
  }

  Future<void> accept(String id) async { try { await _dio.post('/relatives/$id/accept'); } catch (e) { throw _err(e); } }
  Future<void> reject(String id) async { try { await _dio.post('/relatives/$id/reject'); } catch (e) { throw _err(e); } }
  Future<void> remove(String id) async { try { await _dio.delete('/relatives/$id'); } catch (e) { throw _err(e); } }

  Future<List<AppNotification>> notifications() async {
    try {
      final d = (await _dio.get('/notifications')).data;
      return (d['data'] as List).map((e) => AppNotification.fromJson(Map<String, dynamic>.from(e))).toList();
    } catch (e) { throw _err(e); }
  }

  Future<void> markAllRead() async { try { await _dio.post('/notifications/read-all'); } catch (_) {} }
}
