import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/theme.dart';
import '../../core/constants.dart';
import '../../services/hospital_directory_service.dart';
import '../../services/location_service.dart';
import '../../widgets/mumbai_map.dart';
import 'hospital_detail_screen.dart';

Color hospitalStatusColor(String? s) => switch (s) {
      'open' => C.green,
      'limited' => C.amber,
      'full' || 'closed' => C.red,
      _ => C.textHint,
    };

String hospitalStatusLabel(String? s) => switch (s) {
      'open' => 'Open',
      'limited' => 'Limited beds',
      'full' => 'Full',
      'closed' => 'Not accepting',
      'non_emergency' => 'Not for emergencies',
      _ => 'Unknown',
    };

class HospitalsScreen extends StatefulWidget {
  const HospitalsScreen({super.key});
  @override
  State<HospitalsScreen> createState() => _HospitalsScreenState();
}

class _HospitalsScreenState extends State<HospitalsScreen> {
  final _service = HospitalDirectoryService();
  Position? _pos;
  List<Map<String, dynamic>> _list = [];
  bool _loading = true, _offline = false;
  StreamSubscription<Position>? _sub;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _sub?.cancel();
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    final p = await LocationService.getCurrent();
    if (!mounted) return;
    setState(() => _pos = p);
    await _fetch();
    if (p != null) {
      // Moved 100 m or more -> re-rank the hospitals around the new position.
      _sub = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 100)).listen((np) {
        if (!mounted) return;
        setState(() => _pos = np);
        _fetch();
      });
    }
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _fetch()); // beds / OT change while you watch
  }

  Future<void> _fetch() async {
    final p = _pos;
    try {
      if (p == null) throw Exception('no location');
      final data = await _service.nearby(p.latitude, p.longitude);
      if (mounted) setState(() { _list = data; _loading = false; _offline = false; });
    } catch (_) {
      // Server / location unavailable: fall back to the built-in list so the screen is never empty.
      final fallback = Hospitals.list.map((h) {
        final km = p == null ? null : LocationService.distanceKm(p.latitude, p.longitude, h['lat'] as double, h['lng'] as double);
        return <String, dynamic>{
          'name': h['name'], 'phone': h['phone'], 'location': {'lat': h['lat'], 'lng': h['lng']},
          if (km != null) 'distanceKm': double.parse(km.toStringAsFixed(2)),
        };
      }).toList();
      if (p != null) fallback.sort((a, b) => (a['distanceKm'] as double).compareTo(b['distanceKm'] as double));
      if (mounted) setState(() { _list = fallback; _loading = false; _offline = true; });
    }
  }

  Future<void> _directions(Map<String, dynamic> h) async {
    final l = h['location'];
    final ok = await launchUrl(Uri.parse('google.navigation:q=${l['lat']},${l['lng']}&mode=d'));
    if (!ok) await launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${l['lat']},${l['lng']}'), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Nearby hospitals'), actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _fetch)]),
      body: Column(children: [
        SizedBox(height: 200, child: MumbaiMap(userLat: _pos?.latitude, userLng: _pos?.longitude)),
        Container(
          width: double.infinity, color: C.card, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Row(children: [
            Icon(_offline ? Icons.cloud_off : Icons.my_location, size: 14, color: _offline ? C.amber : C.green),
            const SizedBox(width: 6),
            Expanded(child: Text(
              _pos == null ? 'Location off - showing the default list'
                  : _offline ? 'Offline - showing distances only'
                  : 'Live - the list updates as you move${_list.isNotEmpty ? '. Nearest: ${_list.first['name']}' : ''}',
              style: const TextStyle(color: C.textSecondary, fontSize: 11))),
          ]),
        ),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _fetch,
                child: ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: _list.length,
                  itemBuilder: (_, i) => _tile(_list[i], i == 0),
                ),
              )),
      ]),
    );
  }

  Widget _tile(Map<String, dynamic> h, bool nearest) {
    final st = h['status'] as String?;
    final km = h['distanceKm'];
    final canOpen = h['_id'] != null;
    return Card(
      color: C.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: nearest ? C.green : C.border, width: nearest ? 1 : 0.5)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: canOpen ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => HospitalDetailScreen(hospital: h, pos: _pos))) : null,
        child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.local_hospital, color: hospitalStatusColor(st) == C.textHint ? C.red : hospitalStatusColor(st)),
            const SizedBox(width: 10),
            Expanded(child: Text(h['name'] ?? '', style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w600))),
            if (nearest) Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: C.green.withOpacity(0.2), borderRadius: BorderRadius.circular(10)),
                child: const Text('NEAREST', style: TextStyle(color: C.green, fontSize: 10))),
          ]),
          const SizedBox(height: 4),
          Text(km != null ? '${(km as num).toStringAsFixed(1)} km away${h['etaMin'] != null ? ' · ~${h['etaMin']} min' : ''}' : '',
              style: const TextStyle(color: C.textHint, fontSize: 12)),
          if (st != null) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 4, children: [
              _chip(hospitalStatusLabel(st), hospitalStatusColor(st)),
              if (st != 'non_emergency') _chip('${h['availableEmergencyBeds'] ?? 0} beds', C.textSecondary),
              if (st != 'non_emergency') _chip('OT ${(h['otAvailable'] ?? 0) > 0 ? 'free' : 'busy'}', (h['otAvailable'] ?? 0) > 0 ? C.green : C.amber),
            ]),
          ],
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton.icon(onPressed: () => _directions(h), icon: const Icon(Icons.directions, size: 16), label: const Text('Directions')),
            TextButton.icon(onPressed: () => launchUrl(Uri.parse('tel:${h['phone']}')), icon: const Icon(Icons.call, size: 16, color: C.green), label: const Text('Call')),
          ]),
        ])),
      ),
    );
  }

  Widget _chip(String t, Color c) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: c.withOpacity(0.15), borderRadius: BorderRadius.circular(10)),
        child: Text(t, style: TextStyle(color: c, fontSize: 11)),
      );
}
