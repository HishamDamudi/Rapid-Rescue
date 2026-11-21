import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/theme.dart';
import '../../services/hospital_directory_service.dart';
import 'hospitals_screen.dart' show hospitalStatusColor, hospitalStatusLabel;

/// One hospital's public dashboard: live bed / OT numbers, specialties, how many patients are on the way. No patient data.
class HospitalDetailScreen extends StatefulWidget {
  final Map<String, dynamic> hospital;
  final Position? pos;
  const HospitalDetailScreen({super.key, required this.hospital, this.pos});
  @override
  State<HospitalDetailScreen> createState() => _HospitalDetailScreenState();
}

class _HospitalDetailScreenState extends State<HospitalDetailScreen> {
  final _service = HospitalDirectoryService();
  late Map<String, dynamic> _h = widget.hospital;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await _service.detail(_h['_id'] as String, lat: widget.pos?.latitude, lng: widget.pos?.longitude);
      if (mounted) setState(() => _h = d);
    } catch (_) {}
  }

  Future<void> _directions() async {
    final l = _h['location'];
    final ok = await launchUrl(Uri.parse('google.navigation:q=${l['lat']},${l['lng']}&mode=d'));
    if (!ok) await launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${l['lat']},${l['lng']}'), mode: LaunchMode.externalApplication);
  }

  Widget _stat(IconData i, String v, String label, Color c) => Expanded(
        child: Container(
          margin: const EdgeInsets.all(4), padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(color: C.card, borderRadius: BorderRadius.circular(12), border: Border.all(color: C.border, width: 0.5)),
          child: Column(children: [
            Icon(i, color: c),
            const SizedBox(height: 6),
            Text(v, style: const TextStyle(color: C.textPrimary, fontSize: 20, fontWeight: FontWeight.w600)),
            Text(label, style: const TextStyle(color: C.textHint, fontSize: 11)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final st = _h['status'] as String?;
    final col = hospitalStatusColor(st);
    final spec = List<String>.from(_h['specialties'] ?? []);
    final emergency = st != 'non_emergency';
    return Scaffold(
      appBar: AppBar(title: Text(_h['name'] ?? 'Hospital')),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: col.withOpacity(0.15), borderRadius: BorderRadius.circular(14), border: Border.all(color: col, width: 0.8)),
          child: Row(children: [
            Icon(Icons.local_hospital, color: col, size: 32),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(hospitalStatusLabel(st), style: TextStyle(color: col, fontSize: 18, fontWeight: FontWeight.w600)),
              if (_h['distanceKm'] != null) Text('${_h['distanceKm']} km from you · ~${_h['etaMin']} min', style: const TextStyle(color: C.textSecondary, fontSize: 12)),
              if ((_h['address'] ?? '').toString().isNotEmpty) Text(_h['address'], style: const TextStyle(color: C.textHint, fontSize: 12)),
            ])),
          ]),
        ),
        if (emergency) Padding(padding: const EdgeInsets.only(top: 8), child: Row(children: [
          _stat(Icons.bed, '${_h['availableEmergencyBeds'] ?? 0}', 'Emergency beds', C.green),
          _stat(Icons.medical_services, '${_h['otAvailable'] ?? 0}', 'OT free', (_h['otAvailable'] ?? 0) > 0 ? C.green : C.amber),
          _stat(Icons.airport_shuttle, '${_h['incomingNow'] ?? 0}', 'Ambulances coming', C.amber),
        ])),
        if (spec.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text('Specialties', style: TextStyle(color: C.textSecondary, fontSize: 12)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: spec.map((s) => Chip(label: Text(s, style: const TextStyle(fontSize: 12)), backgroundColor: C.card)).toList()),
        ],
        const SizedBox(height: 18),
        SizedBox(height: 48, child: ElevatedButton.icon(onPressed: _directions, icon: const Icon(Icons.navigation), label: const Text('Directions'))),
        const SizedBox(height: 10),
        SizedBox(height: 48, child: OutlinedButton.icon(onPressed: () => launchUrl(Uri.parse('tel:${_h['phone']}')), icon: const Icon(Icons.call, color: C.green), label: Text('Call ${_h['phone'] ?? ''}'))),
        const SizedBox(height: 14),
        const Text('In an emergency press SOS - the nearest suitable hospital is chosen for you automatically and told you are coming.',
            style: TextStyle(color: C.textHint, fontSize: 11)),
        if (_h['capacityUpdatedAt'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Capacity updated by the hospital: ${_h['capacityUpdatedAt'].toString().substring(0, 16).replaceFirst('T', ' ')}', style: const TextStyle(color: C.textHint, fontSize: 10))),
      ])),
    );
  }
}
