import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../core/constants.dart';

/// One shared Socket.IO connection for the whole app (live emergency updates, family alerts).
/// Previously nothing used this class; PushService and the emergency screen now do.
class SocketService {
  static io.Socket? _socket;
  static String? _token;

  static Future<io.Socket> connect() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('accessToken');
    // Reuse the same socket even while it is (re)connecting — the old check created a
    // second connection if called before the first one finished connecting.
    if (_socket != null && _token == token) return _socket!;
    _socket?.dispose();
    _token = token;
    _socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'token': token})
        .build());
    _socket!.connect();
    return _socket!;
  }

  static void disconnect() {
    _socket?.dispose();
    _socket = null;
    _token = null;
  }
}
