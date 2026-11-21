import 'dart:async';
import 'package:flutter/material.dart';
import 'package:vibration/vibration.dart';
import '../core/theme.dart';

class SOSButton extends StatefulWidget {
  final VoidCallback onActivate;
  final bool disabled;
  const SOSButton({super.key, required this.onActivate, this.disabled = false});

  @override
  State<SOSButton> createState() => _SOSButtonState();
}

class _SOSButtonState extends State<SOSButton> with SingleTickerProviderStateMixin {
  late AnimationController _pulseCtrl;
  Timer? _holdTimer;
  double _progress = 0;
  bool _holding = false;
  static const holdMs = 1800;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);
  }

  void _start() {
    if (widget.disabled) return;
    setState(() => _holding = true);
    Vibration.vibrate(duration: 50);
    const tick = Duration(milliseconds: 50);
    int elapsed = 0;
    _holdTimer = Timer.periodic(tick, (t) {
      elapsed += tick.inMilliseconds;
      setState(() => _progress = elapsed / holdMs);
      if (elapsed >= holdMs) {
        t.cancel();
        Vibration.vibrate(pattern: [0, 80, 60, 80]);
        widget.onActivate();
        _cancel();
      }
    });
  }

  void _cancel() {
    _holdTimer?.cancel();
    setState(() { _progress = 0; _holding = false; });
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _holdTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => _start(),
      onTapUp: (_) => _cancel(),
      onTapCancel: _cancel,
      child: AnimatedBuilder(
        animation: _pulseCtrl,
        builder: (_, child) {
          final scale = 1 + _pulseCtrl.value * 0.12;
          return Stack(alignment: Alignment.center, children: [
            Transform.scale(scale: scale, child: Container(
              width: 148, height: 148,
              decoration: BoxDecoration(shape: BoxShape.circle, color: C.red.withOpacity(0.18)),
            )),
            Container(
              width: 130, height: 130,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.disabled ? Colors.grey : C.red,
                border: Border.all(color: C.redDark, width: 5),
              ),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Text('SOS', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 2)),
                Text(_holding ? 'Sending…' : 'Hold to activate', style: const TextStyle(color: Colors.white70, fontSize: 10)),
              ]),
            ),
          ]);
        },
      ),
    );
  }
}
