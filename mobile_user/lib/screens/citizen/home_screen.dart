import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:geolocator/geolocator.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';
import '../../services/location_service.dart';
import '../../services/sensor_service.dart';
import '../../services/incident_service.dart';
import '../../services/offline_queue_service.dart';
import '../../widgets/sos_button.dart';
import '../../widgets/sensor_monitor.dart';
import '../../widgets/mumbai_map.dart';
import '../../services/push_service.dart';
import '../../services/emergency_service.dart';
import 'emergency_screen.dart';
import 'relatives_screen.dart';
import 'profile_screen.dart';
import 'qr_screen.dart';
import 'hospitals_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Position? _pos;
  final _sensorService = SensorService();
  final _incidentService = IncidentService();
  SensorReadings _readings = SensorReadings();
  int _alertCount = 0;
  final _emergencyService = EmergencyService();
  ActiveEmergencies? _active;   // my emergency in progress + my relatives' (drives the red banner)

  @override
  void initState() {
    super.initState();
    _initLocation();
    _sensorService.start(_onSensorAlert, (r) => setState(() => _readings = r));
    OfflineQueueService.watchConnectivity();
    PushService.tick.addListener(_loadActive);   // live: bumped by Socket.IO when anything changes
    _loadActive();
  }

  Future<void> _loadActive() async {
    try {
      final a = await _emergencyService.active();
      if (mounted) setState(() => _active = a);
    } catch (_) {}
  }

  void _openEmergency(String id) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => EmergencyScreen(emergencyId: id))).then((_) => _loadActive());

  List<Widget> _activeBanners() {
    final a = _active;
    if (a == null || a.isEmpty) return const <Widget>[];
    Widget tile(Map<String, dynamic> v, bool mine) {
      // Once the ambulance has the patient the red SOS alert goes away: the patient just sees where they are being taken.
      final moving = mine && (v['pickedUp'] == true || ['transporting', 'hospital_arrived'].contains(v['status']));
      final hosp = (v['hospital'] is Map) ? '${v['hospital']['name'] ?? ''}' : '';
      return Card(
          color: moving ? const Color(0xFF12261C) : const Color(0xFF2A1215),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: moving ? C.greenDark : C.redDark, width: 0.8)),
          child: ListTile(
            leading: Icon(moving ? Icons.local_hospital : Icons.warning_amber_rounded, color: moving ? C.green : C.textRed),
            title: Text(moving ? (v['status'] == 'hospital_arrived' ? 'You have reached the hospital' : 'On the way to hospital')
                : mine ? 'Your emergency is in progress' : '${v['patientName'] ?? 'A relative'} needs help',
                style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w600)),
            subtitle: Text(moving ? (hosp.isNotEmpty ? hosp : 'Hospital being confirmed') : '${v['status'] ?? ''}'.replaceAll('_', ' '), style: const TextStyle(color: C.textSecondary, fontSize: 12)),
            trailing: const Icon(Icons.chevron_right, color: C.textSecondary),
            onTap: () => _openEmergency('${v['_id']}'),
          ),
        );
    }
    return [
      for (final v in a.mine) tile(v, true),
      for (final v in a.relatives) tile(v, false),
      const SizedBox(height: 8),
    ];
  }

  Future<void> _initLocation() async {
    final pos = await LocationService.getCurrent();
    if (pos != null) setState(() => _pos = pos);
    LocationService.watch().listen((p) => setState(() => _pos = p));
  }

  void _onSensorAlert(SensorAlert alert) {
    final labels = {
      SensorTrigger.gyroscope: 'Violent rotation detected',
      SensorTrigger.freefall: 'Free-fall / fall detected',
      SensorTrigger.temperature: 'Rapid temperature change detected',
      SensorTrigger.overheat: 'Dangerous heat level detected',
    };
    final triggerNames = {
      SensorTrigger.gyroscope: 'gyroscope',
      SensorTrigger.freefall: 'freefall',
      SensorTrigger.temperature: 'temperature',
      SensorTrigger.overheat: 'overheat',
    };
    showDialog(context: context, builder: (_) => AlertDialog(
      backgroundColor: C.card,
      title: const Text('⚠️ Auto-SOS Triggered', style: TextStyle(color: C.textRed)),
      content: Text('${labels[alert.trigger]}\n\nAn emergency alert is being sent automatically. If you are fine, open the alert and tap "I\'m safe".', style: const TextStyle(color: C.textPrimary)),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
    ));
    _triggerSOS(trigger: triggerNames[alert.trigger]!, sensorData: {
      'gyroMagnitude': alert.magnitude,
      'temperature': alert.temperature,
      'tempDelta': alert.tempDelta,
    });
  }

  Future<void> _triggerSOS({String trigger = 'manual', Map<String, dynamic>? sensorData}) async {
    // Never send a made-up location: the nearest ambulance and hospital are chosen from these coordinates.
    // (This used to fall back to a hard-coded Mumbai city-centre point whenever GPS had no fix yet, which
    //  would now send an ambulance to the wrong place.)
    final pos = _pos ?? await LocationService.getCurrent().timeout(const Duration(seconds: 8), onTimeout: () => null);
    if (pos == null) {
      if (mounted) {
        showDialog(context: context, builder: (_) => AlertDialog(
          backgroundColor: C.card,
          title: const Text('Location unavailable', style: TextStyle(color: C.textRed)),
          content: const Text('We could not get your GPS location, so help cannot be sent to the right place. '
              'Please turn on location services and try again, or call 112.', style: TextStyle(color: C.textPrimary)),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
        ));
      }
      return;
    }
    final inc = await _incidentService.createIncident(type: 'medical', lat: pos.latitude, lng: pos.longitude, triggerSource: trigger, sensorData: sensorData);
    if (!mounted) return;
    setState(() => _alertCount++);
    if (inc == null) {   // no connection: it is queued and will be sent automatically
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No connection — your SOS is saved and will be sent as soon as you are online.'), backgroundColor: C.amber));
      return;
    }
    _loadActive();
    _openEmergency(inc.id);   // live tracking: ambulance, hospital, family — and "I'm safe" for false alarms
  }

  @override
  void dispose() {
    PushService.tick.removeListener(_loadActive);
    _sensorService.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          CircleAvatar(backgroundColor: C.red, radius: 18, child: Text(user?.name.isNotEmpty == true ? user!.name[0].toUpperCase() : '?', style: const TextStyle(color: Colors.white))),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Welcome, ${user?.name.split(' ').first ?? ''}', style: const TextStyle(fontSize: 14, color: C.textPrimary)),
            Text(user?.uniqueId ?? '', style: const TextStyle(fontSize: 11, color: C.textHint)),
          ])),
        ]),
        actions: [
          IconButton(icon: const Icon(Icons.logout, color: C.textSecondary), onPressed: () => context.read<AuthProvider>().logout()),
        ],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        ..._activeBanners(),
        SizedBox(height: 200, child: ClipRRect(borderRadius: BorderRadius.circular(12),
          child: MumbaiMap(userLat: _pos?.latitude, userLng: _pos?.longitude))),
        const SizedBox(height: 16),
        Card(color: C.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: C.border, width: 0.5)),
          child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [
            const Text('Emergency SOS', style: TextStyle(color: C.textSecondary, fontSize: 13)),
            const SizedBox(height: 8),
            SOSButton(onActivate: () => _triggerSOS()),
            const SizedBox(height: 8),
            const Text('Auto-alerts also fire on fall or temperature spike', style: TextStyle(color: C.textHint, fontSize: 11), textAlign: TextAlign.center),
          ]))),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _statBox('$_alertCount', 'Alerts sent', C.textRed)),
          const SizedBox(width: 8),
          Expanded(child: _statBox(_pos != null ? 'Live' : 'Waiting', 'Location', _pos != null ? C.green : C.amber)),
        ]),
        const SizedBox(height: 16),
        const Text('LIVE SENSORS', style: TextStyle(color: C.textHint, fontSize: 11, letterSpacing: 0.6)),
        const SizedBox(height: 8),
        Card(color: C.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: C.border, width: 0.5)),
          child: Padding(padding: const EdgeInsets.all(14), child: SensorMonitor(readings: _readings))),
        const SizedBox(height: 16),
        const Text('QUICK ACTIONS', style: TextStyle(color: C.textHint, fontSize: 11, letterSpacing: 0.6)),
        const SizedBox(height: 8),
        GridView.count(crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 2.4, children: [
          _actionBtn(Icons.edit, 'Edit profile', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfileScreen()))),
          _actionBtn(Icons.local_hospital, 'Hospitals', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const HospitalsScreen()))),
          _actionBtn(Icons.qr_code, 'My QR ID', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const QRScreen()))),
          ValueListenableBuilder<int>(
            valueListenable: PushService.unread,
            builder: (_, n, __) => _actionBtn(Icons.family_restroom, n > 0 ? 'Relatives ($n new)' : 'Relatives',
              () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RelativesScreen())).then((_) => PushService.refreshUnread())),
          ),
          _actionBtn(Icons.phone, 'Call 112', () {}),
        ]),
      ]),
    );
  }

  Widget _statBox(String num, String label, Color color) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: BoxDecoration(color: C.bg, borderRadius: BorderRadius.circular(10), border: Border.all(color: C.border)),
    child: Column(children: [
      Text(num, style: TextStyle(color: color, fontSize: 22, fontWeight: FontWeight.w500)),
      Text(label, style: const TextStyle(color: C.textHint, fontSize: 11)),
    ]));

  Widget _actionBtn(IconData icon, String label, VoidCallback onTap) => OutlinedButton(
    onPressed: onTap,
    style: OutlinedButton.styleFrom(side: const BorderSide(color: C.border)),
    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
      Icon(icon, size: 18, color: C.textSecondary), const SizedBox(width: 6),
      Flexible(child: Text(label, style: const TextStyle(color: C.textSecondary, fontSize: 12), overflow: TextOverflow.ellipsis)),
    ]));
}
