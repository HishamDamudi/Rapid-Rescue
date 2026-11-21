import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/constants.dart';
import '../services/sensor_service.dart';

class SensorMonitor extends StatelessWidget {
  final SensorReadings readings;
  const SensorMonitor({super.key, required this.readings});

  @override
  Widget build(BuildContext context) {
    final gyroDanger = readings.gyroMag > SensorThresholds.gyroMagnitude;
    final fallDanger = readings.accelMag < SensorThresholds.accelFreefall * 2;
    final temp = readings.temperature;
    final heatDanger = temp != null && temp >= SensorThresholds.tempHighC;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _bar('Gyroscope', readings.gyroMag, 20, SensorThresholds.gyroMagnitude, false),
      const SizedBox(height: 8),
      _bar('Accelerometer', readings.accelMag, 20, SensorThresholds.accelFreefall, true),
      if (temp != null) ...[
        const SizedBox(height: 8),
        _bar('Temperature (°C)', temp, SensorThresholds.tempHighC + 10, SensorThresholds.tempHighC, false),
      ],
      const SizedBox(height: 10),
      Wrap(spacing: 6, children: [
        _chip('Rotation alert', gyroDanger, C.amber),
        _chip('Fall risk', fallDanger, C.red),
        _chip('Heat risk', heatDanger, C.red),
        _chip('Monitoring', true, C.green),
      ]),
    ]);
  }

  Widget _bar(String label, double val, double max, double threshold, bool invert) {
    final pct = (val / max).clamp(0.0, 1.0);
    final danger = invert ? val < threshold : val > threshold;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: const TextStyle(color: C.textHint, fontSize: 11)),
        Text(val.toStringAsFixed(2), style: TextStyle(color: danger ? C.red : C.textPrimary, fontSize: 11)),
      ]),
      const SizedBox(height: 4),
      ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(
        value: pct, minHeight: 5, backgroundColor: C.border,
        color: danger ? C.red : C.green,
      )),
    ]);
  }

  Widget _chip(String label, bool active, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: active ? color.withOpacity(0.15) : C.bg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: active ? color : C.border, width: 0.5),
        ),
        child: Text(label, style: TextStyle(color: active ? color : C.textHint, fontSize: 10)),
      );
}
