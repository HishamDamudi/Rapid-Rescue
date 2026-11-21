import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants.dart';
import '../../core/theme.dart';
import '../../services/emergency_service.dart';
import '../../services/socket_service.dart';

// Small null-safe helpers: the server sends JSON and the shape depends on who is looking.
Map<String, dynamic>? _m(dynamic x) => x is Map ? Map<String, dynamic>.from(x) : null;
List<dynamic> _l(dynamic x) => x is List ? x : const [];
double? _d(dynamic x) => x is num ? x.toDouble() : null;
String _s(dynamic x) => x == null ? '' : '$x';
String _two(int n) => n.toString().padLeft(2, '0');

const _statusLabel = <String, String>{
  'reported': 'Alert received', 'verified': 'Alert verified', 'police_assigned': 'Police assigned',
  'ambulance_assigned': 'Ambulance allocated', 'en_route': 'Ambulance on the way', 'at_scene': 'Ambulance has arrived',
  'transporting': 'On the way to hospital', 'hospital_arrived': 'Reached the hospital',
  'resolved': 'Emergency resolved', 'closed': 'Closed', 'cancelled': 'Alert cancelled',
};
const _stepOrder = <String, int>{
  'reported': 0, 'verified': 0, 'police_assigned': 0, 'ambulance_assigned': 1, 'en_route': 2,
  'at_scene': 3, 'transporting': 4, 'hospital_arrived': 5, 'resolved': 6, 'closed': 6,
};
const _steps = <String>['Reported', 'Ambulance\nallocated', 'On the\nway', 'Arrived', 'To\nhospital', 'At\nhospital'];
const _ackNotes = <String>['On my way to the hospital', 'I am calling them now', 'I have informed other family'];

/// Live emergency tracking. Same screen for the patient and for a relative — the server decides
/// what each of them may see (relatives never receive medical details) and which actions apply.
class EmergencyScreen extends StatefulWidget {
  /// Database id of the incident (notifications carry it as `emergencyId`).
  final String emergencyId;
  const EmergencyScreen({super.key, required this.emergencyId});
  @override
  State<EmergencyScreen> createState() => _EmergencyScreenState();
}

class _EmergencyScreenState extends State<EmergencyScreen> {
  final _svc = EmergencyService();
  final _map = MapController();
  Map<String, dynamic>? _v;
  String? _error;
  bool _busy = false;
  String? _ackNote;
  String _fitKey = '';
  Timer? _poll, _clock;
  io.Socket? _sock;

  bool get _pending => _m(_v?['dispatch'])?['state'] == 'pending';

  @override
  void initState() {
    super.initState();
    _load();
    _connect();
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load());               // safety net if the socket drops
    _clock = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted && _pending) setState(() {}); }); // countdown
  }

  @override
  void dispose() {
    _poll?.cancel();
    _clock?.cancel();
    try {
      _sock?.off('emergency:update', _onUpdate);
      _sock?.off('emergency:vehicle', _onVehicle);
      _sock?.off('connect', _onConnect);
    } catch (_) {}
    super.dispose();
  }

  // ───────────── live updates (existing Socket.IO connection) ─────────────
  Future<void> _connect() async {
    try {
      final s = await SocketService.connect();
      _sock = s;
      s.on('emergency:update', _onUpdate);   // tiny "something changed" ping → re-fetch my filtered view
      s.on('emergency:vehicle', _onVehicle); // live ambulance position
      s.on('connect', _onConnect);           // rooms are lost on reconnect → join again
      if (s.connected) _join();
    } catch (_) {}
  }

  void _join() => _sock?.emit('join_incident', widget.emergencyId);
  void _onConnect(dynamic _) => _join();
  void _onUpdate(dynamic p) {
    if (p is Map && _s(p['incidentId']) == widget.emergencyId) _load();
  }
  void _onVehicle(dynamic p) {
    if (!mounted || p is! Map || _s(p['incidentId']) != widget.emergencyId) return;
    final amb = _v?['ambulance'];
    if (amb is Map) setState(() => amb['location'] = {'lat': p['lat'], 'lng': p['lng'], 'ts': p['ts']});
  }

  Future<void> _load() async {
    try {
      final v = await _svc.track(widget.emergencyId);
      if (!mounted) return;
      setState(() { _v = v; _error = null; });
      WidgetsBinding.instance.addPostFrameCallback((_) => _fit());
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    }
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action) async {
    setState(() => _busy = true);
    try {
      final v = await action();
      if (mounted) setState(() { _v = v; _error = null; });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'), backgroundColor: C.redDark));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _open(String url) async {
    try { await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication); } catch (_) {}
  }

  Future<void> _confirmCancel() async {
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      backgroundColor: C.card,
      title: const Text('Cancel the emergency alert?'),
      content: const Text('Use this only if you are safe. Ambulance, hospital and police requests are withdrawn and your family is told it was a false alarm.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep alert')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("I'm safe — cancel", style: TextStyle(color: C.red))),
      ],
    ));
    if (ok == true) await _run(() => _svc.cancel(widget.emergencyId));
  }

  // ───────────── map ─────────────
  ll.LatLng? _ll(Map<String, dynamic>? m) {
    final la = _d(m?['lat']), lo = _d(m?['lng']);
    return la == null || lo == null ? null : ll.LatLng(la, lo);
  }

  List<ll.LatLng> _points(Map<String, dynamic> v) => [
        _ll(_m(v['location'])), _ll(_m(_m(v['ambulance'])?['location'])), _ll(_m(_m(v['hospital'])?['location'])),
      ].whereType<ll.LatLng>().toList();

  /// Re-frame the camera only when something new appears (ambulance, hospital, phase), so we never fight the user's panning.
  void _fit() {
    final v = _v;
    if (v == null || !mounted) return;
    final key = '${_m(v['ambulance']) != null}-${_s(_m(v['ambulance'])?['phase'])}-${_m(v['hospital']) != null}';
    if (key == _fitKey) return;
    _fitKey = key;
    final pts = _points(v);
    try {
      if (pts.length >= 2) {
        _map.fitCamera(CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(48), maxZoom: 16));
      } else if (pts.length == 1) {
        _map.move(pts.first, 15);
      }
    } catch (_) {/* map not laid out yet — the initial camera already shows the patient */}
  }

  Widget _mapView(Map<String, dynamic> v) {
    final patient = _ll(_m(v['location']));
    final amb = _ll(_m(_m(v['ambulance'])?['location']));
    final hosp = _ll(_m(_m(v['hospital'])?['location']));
    return SizedBox(height: 230, child: ClipRRect(borderRadius: BorderRadius.circular(12), child: FlutterMap(
      mapController: _map,
      options: MapOptions(initialCenter: patient ?? ll.LatLng(Mumbai.lat, Mumbai.lng), initialZoom: 14),
      children: [
        TileLayer(urlTemplate: Mumbai.tileUrl, userAgentPackageName: 'com.rapidrescue.app'),
        MarkerLayer(markers: [
          if (hosp != null) Marker(point: hosp, width: 34, height: 34, child: const Icon(Icons.local_hospital, color: C.blueLight, size: 30)),
          if (patient != null) Marker(point: patient, width: 36, height: 36, child: const Icon(Icons.warning_rounded, color: C.red, size: 32)),
          if (amb != null) Marker(point: amb, width: 36, height: 36, child: const Icon(Icons.emergency, color: C.amber, size: 32)),
        ]),
      ],
    )));
  }

  // ───────────── building blocks ─────────────
  Widget _card(Widget child, {Color? color, Color? border}) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        color: color ?? C.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: border ?? C.border, width: 0.8)),
        child: Padding(padding: const EdgeInsets.all(14), child: child),
      );

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 4),
        child: Text(t.toUpperCase(), style: const TextStyle(color: C.textHint, fontSize: 11, letterSpacing: 0.6)),
      );

  Widget _statusCard(Map<String, dynamic> v) {
    final st = _s(v['status']);
    final active = v['active'] == true;
    final color = st == 'cancelled' ? C.amber : (active ? C.red : C.green);
    final amb = _m(v['ambulance']);
    final eta = amb?['etaMin'];
    String sub = active ? 'Updating live' : 'This emergency is closed.';
    if (active && amb != null && eta != null && _s(amb['phase']) != 'arrived') sub = 'About $eta min away · updating live';
    return _card(
      Row(children: [
        Icon(active ? Icons.emergency : (st == 'cancelled' ? Icons.cancel : Icons.check_circle), color: color, size: 30),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_statusLabel[st] ?? st, style: const TextStyle(color: C.textPrimary, fontSize: 17, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(sub, style: const TextStyle(color: C.textSecondary, fontSize: 12)),
        ])),
      ]),
      color: color.withOpacity(0.10), border: color,
    );
  }

  Widget _pendingBanner(Map<String, dynamic> v) {
    final d = _m(v['dispatch']);
    final due = DateTime.tryParse(_s(d?['dueAt']))?.toLocal();
    final left = due == null ? 0 : due.difference(DateTime.now()).inSeconds;
    final secs = left < 0 ? 0 : left;
    final patient = !v.containsKey('canAcknowledge');
    return _card(Row(children: [
      const Icon(Icons.timer, color: C.amber),
      const SizedBox(width: 10),
      Expanded(child: Text(
        patient ? 'Automatic alert detected. Help will be sent in ${secs}s unless you tap "I\'m safe".'
                : 'Automatic alert detected. Help is sent in ${secs}s unless the patient cancels.',
        style: const TextStyle(color: C.textPrimary, fontSize: 13))),
    ]), color: const Color(0x22FF9800), border: C.amber);
  }

  Widget _stepper(String status) {
    final cur = _stepOrder[status] ?? 0;
    return _card(Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (int i = 0; i < _steps.length; i++)
        Expanded(child: Column(children: [
          Container(
            width: 22, height: 22, alignment: Alignment.center,
            decoration: BoxDecoration(shape: BoxShape.circle, color: i <= cur ? C.green : C.border),
            child: Icon(i <= cur ? Icons.check : Icons.circle, size: i <= cur ? 14 : 6, color: i <= cur ? Colors.white : C.textHint),
          ),
          const SizedBox(height: 4),
          Text(_steps[i], textAlign: TextAlign.center, style: TextStyle(color: i <= cur ? C.textPrimary : C.textHint, fontSize: 9)),
        ])),
    ]));
  }

  Widget? _ambulanceCard(Map<String, dynamic> v) {
    final a = _m(v['ambulance']);
    if (a == null) return null;
    final phase = _s(a['phase']);
    final where = phase == 'to_hospital' ? 'Taking the patient to hospital' : (phase == 'arrived' ? "At the patient's location" : 'Heading to the patient');
    final eta = a['etaMin'], km = a['distanceKm'];
    return _card(Row(children: [
      const Icon(Icons.emergency, color: C.amber, size: 28),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Ambulance ${_s(a['registrationNumber'])}', style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w600)),
        Text(where, style: const TextStyle(color: C.textSecondary, fontSize: 12)),
        if (_s(a['driverName']).isNotEmpty) Text('Driver: ${_s(a['driverName'])}', style: const TextStyle(color: C.textHint, fontSize: 11)),
      ])),
      if (eta != null) Column(children: [
        Text(phase == 'arrived' ? 'Here' : '~$eta min', style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w600)),
        if (km != null && phase != 'arrived') Text('$km km', style: const TextStyle(color: C.textHint, fontSize: 11)),
      ]),
    ]));
  }

  Widget _hospitalCard(Map<String, dynamic> v) {
    final h = _m(v['hospital']);
    final search = _s(v['hospitalSearch']);
    if (h != null && h['accepted'] == true) {
      final phone = _s(h['phone']);
      return _card(Row(children: [
        const Icon(Icons.local_hospital, color: C.blueLight, size: 28),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_s(h['name']), style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w600)),
          if (_s(h['address']).isNotEmpty) Text(_s(h['address']), style: const TextStyle(color: C.textSecondary, fontSize: 12)),
          const Text('Confirmed — hospital is expecting the patient', style: TextStyle(color: C.green, fontSize: 11)),
        ])),
        if (phone.isNotEmpty) IconButton(tooltip: 'Call hospital', icon: const Icon(Icons.phone, color: C.green), onPressed: () => _open('tel:$phone')),
      ]));
    }
    final text = h != null ? 'Hospital chosen — waiting for confirmation'
        : (search == 'none' ? 'A dispatcher is arranging a hospital' : 'Finding the best available hospital…');
    return _card(Row(children: [
      const Icon(Icons.local_hospital_outlined, color: C.textHint, size: 26),
      const SizedBox(width: 12),
      Expanded(child: Text(text, style: const TextStyle(color: C.textSecondary, fontSize: 13))),
      if (h == null && search == 'searching') const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
    ]));
  }

  Widget _familyCard(Map<String, dynamic> v) {
    final acks = _l(v['acknowledgements']);
    if (acks.isEmpty) return const SizedBox.shrink();
    return _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Family who have seen this', style: TextStyle(color: C.textHint, fontSize: 11)),
      const SizedBox(height: 6),
      for (final a in acks) Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: [
        const Icon(Icons.check_circle, color: C.green, size: 16),
        const SizedBox(width: 8),
        Expanded(child: Text('${_s(_m(a)?['name'])}${_s(_m(a)?['note']).isNotEmpty ? ' — "${_s(_m(a)?['note'])}"' : ''}',
            style: const TextStyle(color: C.textPrimary, fontSize: 13))),
      ])),
    ]));
  }

  Widget _ackCard(Map<String, dynamic> v) {
    if (v['canAcknowledge'] != true) return const SizedBox.shrink();
    if (v['acknowledgedByMe'] == true) {
      return _card(const Row(children: [
        Icon(Icons.check_circle, color: C.green),
        SizedBox(width: 8),
        Expanded(child: Text('You have acknowledged this emergency.', style: TextStyle(color: C.textPrimary))),
      ]));
    }
    return _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Let them (and the family) know you have seen this', style: TextStyle(color: C.textSecondary, fontSize: 12)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 4, children: [
        for (final n in _ackNotes) ChoiceChip(
          label: Text(n, style: const TextStyle(fontSize: 11)),
          selected: _ackNote == n,
          onSelected: (sel) => setState(() => _ackNote = sel ? n : null),
        ),
      ]),
      const SizedBox(height: 10),
      SizedBox(width: double.infinity, child: ElevatedButton.icon(
        onPressed: _busy ? null : () => _run(() => _svc.acknowledge(widget.emergencyId, note: _ackNote)),
        icon: const Icon(Icons.visibility, size: 18),
        label: const Text("I've seen this alert"),
      )),
    ]));
  }

  Widget _timeline(Map<String, dynamic> v) {
    final items = _l(v['timeline']).reversed.toList();   // newest first
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _label('Timeline'),
      _card(Column(children: [
        for (final raw in items) Builder(builder: (_) {
          final t = _m(raw) ?? const <String, dynamic>{};
          final d = DateTime.tryParse(_s(t['timestamp']))?.toLocal();
          final text = _s(t['note']).isNotEmpty ? _s(t['note']) : _s(t['status']).replaceAll('_', ' ');
          return Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 44, child: Text(d == null ? '' : '${_two(d.hour)}:${_two(d.minute)}', style: const TextStyle(color: C.textHint, fontSize: 11))),
            const Padding(padding: EdgeInsets.only(top: 5, right: 8), child: Icon(Icons.circle, size: 6, color: C.textHint)),
            Expanded(child: Text(text, style: const TextStyle(color: C.textSecondary, fontSize: 12))),
          ]));
        }),
      ])),
    ]);
  }

  List<Widget> _sections(Map<String, dynamic> v) {
    final relative = v.containsKey('canAcknowledge');
    final active = v['active'] == true;
    final loc = _m(v['location']);
    final la = _d(loc?['lat']), lo = _d(loc?['lng']);
    final phone = _s(v['patientPhone']);
    return [
      _statusCard(v),
      if (_pending) _pendingBanner(v),
      if (_s(v['status']) != 'cancelled') _stepper(_s(v['status'])),
      _mapView(v),
      const SizedBox(height: 12),
      if (_ambulanceCard(v) != null) _ambulanceCard(v)!,
      _hospitalCard(v),
      _familyCard(v),
      if (active && relative) _ackCard(v),
      if (active && relative) Row(children: [
        if (phone.isNotEmpty) Expanded(child: OutlinedButton.icon(onPressed: () => _open('tel:$phone'), icon: const Icon(Icons.phone, size: 16), label: Text('Call ${_s(v['patientName']).split(' ').first}'))),
        if (phone.isNotEmpty && la != null) const SizedBox(width: 8),
        if (la != null && lo != null) Expanded(child: OutlinedButton.icon(onPressed: () => _open('https://www.google.com/maps/search/?api=1&query=$la,$lo'), icon: const Icon(Icons.map, size: 16), label: const Text('Open location'))),
      ]),
      if (active && !relative && v['canCancel'] == true) SizedBox(width: double.infinity, child: OutlinedButton.icon(
        onPressed: _busy ? null : _confirmCancel,
        style: OutlinedButton.styleFrom(side: const BorderSide(color: C.redDark), foregroundColor: C.textRed),
        icon: const Icon(Icons.shield_outlined, size: 18),
        label: const Text("I'm safe — cancel alert"),
      )),
      if (active && !relative && v['canCancel'] != true) const Padding(
        padding: EdgeInsets.only(top: 4),
        child: Text('Responders are already with you. If you are fine, please tell them directly.', style: TextStyle(color: C.textHint, fontSize: 12)),
      ),
      const SizedBox(height: 16),
      _timeline(v),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final v = _v;
    final relative = v != null && v.containsKey('canAcknowledge');
    return Scaffold(
      appBar: AppBar(
        title: Text(v == null ? 'Emergency' : (relative ? '${_s(v['patientName'])} needs help' : 'Your emergency')),
        actions: [IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: v == null
          ? Center(child: _error == null
              ? const CircularProgressIndicator()
              : Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: C.textSecondary)),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _load, child: const Text('Try again')),
                ])))
          : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: _sections(v))),
    );
  }
}
