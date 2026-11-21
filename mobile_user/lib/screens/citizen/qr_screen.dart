import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';

class QRScreen extends StatelessWidget {
  const QRScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final u = context.watch<AuthProvider>().user;
    final qrPayload = '{"uid":"${u?.uniqueId}","name":"${u?.name}"}';
    return Scaffold(
      appBar: AppBar(title: const Text('Emergency QR ID')),
      body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
          child: QrImageView(data: qrPayload, size: 220, backgroundColor: Colors.white)),
        const SizedBox(height: 20),
        Text(u?.name ?? '', style: const TextStyle(color: C.textPrimary, fontSize: 18, fontWeight: FontWeight.w500)),
        Text(u?.uniqueId ?? '', style: const TextStyle(color: C.textHint, fontFamily: 'monospace')),
        const SizedBox(height: 8),
        const Text('First responders can scan this to instantly view your\nblood type, allergies, and emergency contact.',
          textAlign: TextAlign.center, style: TextStyle(color: C.textSecondary, fontSize: 12)),
      ]))),
    );
  }
}
