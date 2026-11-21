import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geolocator_android/geolocator_android.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:url_launcher/url_launcher.dart';
import 'config.dart';
import 'core/theme.dart';
import 'api.dart';
import 'login_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  Map<String, dynamic>? vehicle, incident;
  String? _error;
  bool _busy = false;
  io.Socket? _socket;
  StreamSubscription<Position>? _gps;
  Timer? _poll;
  Position? _pos;                 // latest GPS fix (live distance to patient / hospital)
  String? _navFor;                // incident id we already auto-opened hospital directions for
  String? _lastStatus;

  @override
  void initState() {
    super.initState();
    _load();
    _connect();
    _startGps();
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load()); // safety net if a push is missed
  }

  @override
  void dispose() { _poll?.cancel(); _gps?.cancel(); _socket?.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.assignment();
      if (mounted) setState(() { vehicle = d['vehicle']; incident = d['incident']; _error = null; });
      final inc = d['incident'];
      final st = inc?['status'];
      if (inc != null && st == 'transporting' && _lastStatus != 'transporting' && _navFor != inc['_id'] && inc['assignedHospital'] != null) {
        _navFor = inc['_id'] as String;
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Patient picked up - directions to the hospital opened'), backgroundColor: C.greenDark));
        _navigate();   // hospital directions, automatically
      }
      _lastStatus = st as String?;
    } on ApiError catch (e) {
      if (e.unauthorized) return _logout();
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _connect() async {
    final t = await Api.token();
    _socket = io.io(AppConfig.socketUrl, io.OptionBuilder().setTransports(['websocket']).setAuth({'token': t}).enableReconnection().build());
    _socket!.on('vehicle:assigned', (_) { _load(); }); // new incident pushed live by dispatch
    // Dispatch / the patient cancelled the call: the server has already freed this vehicle — refresh so we stop navigating to it.
    _socket!.on('incident:cancelled', (_) {
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This call was cancelled — you are free for the next one.')));
    });
    _socket!.on('emergency:update', (_) { _load(); }); // e.g. the hospital accepted the patient
    _socket!.connect();
  }

  Future<void> _startGps() async {
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
      if (mounted) setState(() => _error = 'Location permission needed so dispatch can see you');
      return;
    }
    // Every ~3 s (even when parked) so the server can detect "within 10 m of the patient". The foreground service keeps
    // this running while Google Maps is in front, otherwise arrival would never be detected.
    _gps = Geolocator.getPositionStream(locationSettings: AndroidSettings(
      accuracy: LocationAccuracy.best, distanceFilter: 0, intervalDuration: const Duration(seconds: 3),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'RapidRescue Driver', notificationText: 'Sharing your live location with dispatch', enableWakeLock: true),
    )).listen((pos) {
      _pos = pos;
      _socket?.emit('vehicle:location', {'lat': pos.latitude, 'lng': pos.longitude, 'heading': pos.heading, 'speed': pos.speed, 'accuracy': pos.accuracy});
      if (mounted) setState(() {});
    });
  }

  Future<void> _status(String s) async {
    setState(() => _busy = true);
    try { await Api.setStatus(s); await _load(); }
    on ApiError catch (e) { if (mounted) setState(() => _error = e.message); }
    if (mounted) setState(() => _busy = false);
  }

  Map<String, dynamic>? get _target {
    final i = incident;
    if (i == null) return null;
    if (i['status'] == 'transporting' && i['assignedHospital'] != null) return Map<String, dynamic>.from(i['assignedHospital']['location']);
    return Map<String, dynamic>.from(i['location']);
  }

  double? get _distM {
    final t = _target;
    if (t == null || _pos == null) return null;
    return Geolocator.distanceBetween(_pos!.latitude, _pos!.longitude, (t['lat'] as num).toDouble(), (t['lng'] as num).toDouble());
  }

  String _fmt(double m) => m >= 1000 ? '${(m / 1000).toStringAsFixed(1)} km' : '${m.round()} m';

  Future<void> _navigate() async {
    final i = incident!;
    final dest = (i['status'] == 'transporting' && i['assignedHospital'] != null) ? i['assignedHospital']['location'] : i['location'];
    final uri = Uri.parse('google.navigation:q=${dest['lat']},${dest['lng']}&mode=d');
    if (!await launchUrl(uri)) await launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${dest['lat']},${dest['lng']}'), mode: LaunchMode.externalApplication);
  }

  Future<void> _logout() async {
    await Api.logout();
    if (mounted) Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginPage()), (_) => false);
  }

  Future<void> _changePw() async {
    final o = TextEditingController(), n = TextEditingController();
    String? msg;
    await showDialog(context: context, builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      backgroundColor: C.card, title: const Text('Change password'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: o, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
        const SizedBox(height: 10),
        TextField(controller: n, obscureText: true, decoration: const InputDecoration(labelText: 'New password (min 6)')),
        if (msg != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(msg!, style: const TextStyle(color: C.textRed, fontSize: 12))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
        TextButton(onPressed: () async {
          try { await Api.changePassword(o.text, n.text); if (c.mounted) Navigator.pop(c); }
          on ApiError catch (e) { set(() => msg = e.message); }
        }, child: const Text('Save')),
      ],
    )));
  }

  @override
  Widget build(BuildContext context) {
    final amb = vehicle?['type'] == 'ambulance';
    final st = (incident?['status'] ?? '') as String;
    return Scaffold(
      appBar: AppBar(
        title: Text('${amb ? '🚑' : '🚓'} ${vehicle?['loginId'] ?? ''}'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          PopupMenuButton<String>(onSelected: (v) => v == 'pw' ? _changePw() : _logout(),
            itemBuilder: (_) => const [PopupMenuItem(value: 'pw', child: Text('Change password')), PopupMenuItem(value: 'out', child: Text('Log out'))]),
        ],
      ),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
        if (vehicle != null) _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(vehicle!['registrationNumber'] ?? '', style: const TextStyle(color: C.textPrimary, fontSize: 16, fontWeight: FontWeight.w500)),
          Text('${vehicle!['stationName'] ?? ''} · ${vehicle!['driverName'] ?? ''}', style: const TextStyle(color: C.textSecondary, fontSize: 12)),
          const SizedBox(height: 6),
          _tag(vehicle!['status'] ?? '', C.green),
        ])),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: C.textRed, fontSize: 12))),
        const SizedBox(height: 12),
        if (incident == null)
          _card(const Column(children: [
            Icon(Icons.hourglass_empty, color: C.textHint, size: 40), SizedBox(height: 8),
            Text('No active assignment', style: TextStyle(color: C.textPrimary)),
            Text('Waiting for dispatch…', style: TextStyle(color: C.textHint, fontSize: 12)),
          ]))
        else ...[
          _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text(incident!['incidentId'] ?? '', style: const TextStyle(color: C.textPrimary, fontSize: 18, fontWeight: FontWeight.w600)),
              _tag(st, C.red),
            ]),
            const SizedBox(height: 8),
            _row('Type', '${incident!['type'] ?? ''} · ${incident!['severity'] ?? ''}'),
            _row('Patient', incident!['reporterName'] ?? '–'),
            _row('Blood', incident!['reporterBloodGroup'] ?? '–'),
            if ((incident!['reporterMedicalNotes'] ?? '').toString().isNotEmpty) _row('Medical', incident!['reporterMedicalNotes']),
            // Present for the ambulance crew only — the server never sends medical details to police vans.
            if (((incident!['medical']?['allergies'] ?? []) as List).isNotEmpty) _row('Allergies', (incident!['medical']['allergies'] as List).join(', ')),
            if (((incident!['medical']?['conditions'] ?? []) as List).isNotEmpty) _row('Conditions', (incident!['medical']['conditions'] as List).join(', ')),
            _row('Location', incident!['location']?['address'] ?? '${incident!['location']?['lat']}, ${incident!['location']?['lng']}'),
            if (incident!['assignedHospital'] != null) _row('Hospital', '${incident!['assignedHospital']['name'] ?? ''}${incident!['hospitalAccepted'] == true ? ' ✓ accepted' : ' (awaiting confirmation)'}'),
          ])),
          const SizedBox(height: 12),
          if (amb && _distM != null) ...[
            _card(Row(children: [
              Icon(st == 'transporting' || st == 'hospital_arrived' ? Icons.local_hospital : Icons.my_location, color: st == 'transporting' ? C.green : C.amber, size: 30),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(st == 'transporting' ? 'Patient on board - ${_fmt(_distM!)} to hospital' : st == 'hospital_arrived' ? 'At the hospital' : '${_fmt(_distM!)} to patient',
                    style: const TextStyle(color: C.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
                Text(st == 'transporting' ? (incident!['assignedHospital']?['name'] ?? '') : 'Pickup is detected automatically within 10 m',
                    style: const TextStyle(color: C.textSecondary, fontSize: 12)),
                if (st == 'transporting' && incident!['otStatus'] != null)
                  Text(incident!['otStatus'] == 'ready' ? 'Hospital: operating theatre READY' : 'Hospital has been told to keep an OT ready',
                      style: TextStyle(color: incident!['otStatus'] == 'ready' ? C.green : C.amber, fontSize: 12)),
              ])),
            ])),
            const SizedBox(height: 12),
          ],
          SizedBox(height: 48, child: ElevatedButton.icon(onPressed: _navigate, icon: const Icon(Icons.navigation),
              label: Text(st == 'transporting' ? 'Directions to hospital' : 'Navigate to patient'))),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            _btn('En route', 'en_route', st, C.blue),
            _btn('At scene', 'at_scene', st, C.amber),
            if (amb) _btn('Patient picked up', 'transporting', st, C.redDark),   // manual fallback if GPS cannot confirm the 10 m radius
            _btn('Complete', 'available', st, C.greenDark),
          ]),
        ],
      ])),
    );
  }

  Widget _btn(String label, String status, String current, Color col) => ElevatedButton(
        style: ElevatedButton.styleFrom(backgroundColor: current == status ? col : col.withOpacity(0.45)),
        onPressed: _busy ? null : () => _status(status),
        child: Text(label));
  Widget _card(Widget c) => Container(width: double.infinity, padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: C.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: C.border, width: 0.5)), child: c);
  Widget _tag(String t, Color c) => Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(color: c.withOpacity(0.2), borderRadius: BorderRadius.circular(20)), child: Text(t, style: TextStyle(color: c, fontSize: 11)));
  Widget _row(String k, String v) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 72, child: Text(k, style: const TextStyle(color: C.textHint, fontSize: 12))),
        Expanded(child: Text(v, style: const TextStyle(color: C.textPrimary, fontSize: 13))),
      ]));
}
