import 'dart:async';
import 'dart:math';
import 'package:sensors_plus/sensors_plus.dart';
import '../core/constants.dart';
import 'temperature_channel.dart';

enum SensorTrigger { gyroscope, freefall, temperature, overheat }

class SensorAlert {
  final SensorTrigger trigger;
  final double? magnitude;
  final double? temperature;
  final double? tempDelta;
  SensorAlert(this.trigger, {this.magnitude, this.temperature, this.tempDelta});
}

class SensorReadings {
  double gyroMag = 0, accelMag = 0;
  double? temperature;
}

class SensorService {
  StreamSubscription? _gyroSub, _accelSub, _tempSub;
  DateTime? _gyroHighSince, _freefallSince, _overheatSince;
  final _readings = SensorReadings();
  final Map<SensorTrigger, DateTime> _lastAlert = {};
  static const _cooldown = Duration(seconds: 10);
  // Sliding window of recent (timestamp, celsius) readings, used to detect a
  // rapid rise even if it never crosses the absolute overheat threshold.
  final List<MapEntry<DateTime, double>> _tempWindow = [];

  void start(void Function(SensorAlert) onAlert, void Function(SensorReadings) onReadings) {
    _gyroSub = gyroscopeEventStream().listen((e) {
      final mag = sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
      _readings.gyroMag = mag;
      onReadings(_readings);
      if (mag > SensorThresholds.gyroMagnitude) {
        _gyroHighSince ??= DateTime.now();
        if (DateTime.now().difference(_gyroHighSince!).inMilliseconds >= SensorThresholds.gyroSustainedMs) {
          _fire(SensorAlert(SensorTrigger.gyroscope, magnitude: mag), onAlert);
          _gyroHighSince = null;
        }
      } else {
        _gyroHighSince = null;
      }
    });

    _accelSub = accelerometerEventStream().listen((e) {
      final mag = sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
      _readings.accelMag = mag;
      onReadings(_readings);
      if (mag < SensorThresholds.accelFreefall) {
        _freefallSince ??= DateTime.now();
        if (DateTime.now().difference(_freefallSince!).inMilliseconds >= SensorThresholds.accelFreefallMs) {
          _fire(SensorAlert(SensorTrigger.freefall, magnitude: mag), onAlert);
          _freefallSince = null;
        }
      } else {
        _freefallSince = null;
      }
    });
    _tempSub = TemperatureChannel.stream.listen((celsius) {
      _readings.temperature = celsius;
      onReadings(_readings);
      final now = DateTime.now();

      // 1) Rapid rise: compare against the oldest reading still inside the window.
      _tempWindow.add(MapEntry(now, celsius));
      _tempWindow.removeWhere((e) => now.difference(e.key).inMilliseconds > SensorThresholds.tempWindowMs);
      final oldest = _tempWindow.first.value;
      final delta = celsius - oldest;
      if (delta >= SensorThresholds.tempDeltaC) {
        _fire(SensorAlert(SensorTrigger.temperature, temperature: celsius, tempDelta: delta), onAlert);
        _tempWindow.clear();
        _tempWindow.add(MapEntry(now, celsius));
      }

      // 2) Sustained high absolute temperature: device is just plain hot
      // (left in a car, near a fire, extreme ambient heat, etc).
      if (celsius >= SensorThresholds.tempHighC) {
        _overheatSince ??= now;
        if (now.difference(_overheatSince!).inMilliseconds >= SensorThresholds.tempHighSustainedMs) {
          _fire(SensorAlert(SensorTrigger.overheat, temperature: celsius), onAlert);
          _overheatSince = null;
        }
      } else {
        _overheatSince = null;
      }
    });
  }

  void _fire(SensorAlert alert, void Function(SensorAlert) cb) {
    final last = _lastAlert[alert.trigger];
    if (last != null && DateTime.now().difference(last) < _cooldown) return;
    _lastAlert[alert.trigger] = DateTime.now();
    cb(alert);
  }

  void stop() {
    _gyroSub?.cancel();
    _accelSub?.cancel();
    _tempSub?.cancel();
  }
}
