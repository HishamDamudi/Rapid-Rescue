import 'package:flutter/services.dart';

/// Bridges to native Android code that reads the device's battery/thermal
/// sensor (there's no cross-platform Flutter API for this, so it needs a
/// small native hook — see android/.../MainActivity.kt).
class TemperatureChannel {
  static const _events = EventChannel('rapidrescue/temperature');

  /// Stream of device temperature readings in Celsius. Emits whenever the
  /// system broadcasts a battery status change (typically every few seconds
  /// or on any noticeable change) — not a fixed-interval poll.
  static Stream<double> get stream =>
      _events.receiveBroadcastStream().map((e) => (e as num).toDouble());
}
