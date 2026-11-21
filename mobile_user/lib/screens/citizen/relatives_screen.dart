import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';
import '../../services/push_service.dart';
import '../../services/relative_service.dart';

/// Tab 0: your ID code, add a relative by their ID code, accept/reject requests.
/// Tab 1: alerts from relatives (their SOS, requests, acceptances).
class RelativesScreen extends StatefulWidget {
  final int initialTab;
  const RelativesScreen({super.key, this.initialTab = 0});
  @override
  State<RelativesScreen> createState() => _RelativesScreenState();
}

class _RelativesScreenState extends State<RelativesScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _svc = RelativeService();
  final _code = TextEditingController();
  RelativesData? _data;
  List<AppNotification> _alerts = [];
  String? _error;
  bool _busy = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this, initialIndex: widget.initialTab);
    // Opening the Alerts tab (tap or swipe) marks everything as read.
    _tabs.addListener(() { if (!_tabs.indexIsChanging && _tabs.index == 1) _markRead(); });
    _load().then((_) { if (widget.initialTab == 1) _markRead(); });
    PushService.tick.addListener(_load);
    // Light polling so requests/alerts show up live even when push isn't set up.
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  Future<void> _markRead() async { await _svc.markAllRead(); PushService.refreshUnread(); }

  @override
  void dispose() {
    _tabs.dispose();
    _poll?.cancel();
    PushService.tick.removeListener(_load);
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await _svc.list();
      final n = await _svc.notifications();
      if (!mounted) return;
      setState(() { _data = d; _alerts = n; _error = null; });
    } on RelError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _toast(String m, {bool bad = false}) => ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(m), backgroundColor: bad ? C.redDark : C.greenDark));

  Future<void> _run(Future<String?> Function() f) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final msg = await f();
      if (msg != null) _toast(msg);
      await _load();
    } on RelError catch (e) {
      _toast(e.message, bad: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final code = _code.text.trim();
    if (code.isEmpty) return;
    await _run(() async { final m = await _svc.add(code); _code.clear(); return m; });
  }

  Future<void> _open(String url) async {
    try { await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication); } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<AuthProvider>().user;
    final newAlerts = _alerts.where((a) => !a.read).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Relatives'),
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            const Tab(text: 'Relatives'),
            Tab(text: newAlerts > 0 ? 'Alerts ($newAlerts)' : 'Alerts'),
          ],
        ),
      ),
      body: TabBarView(controller: _tabs, children: [_relativesTab(me?.uniqueId ?? ''), _alertsTab()]),
    );
  }

  Widget _card(Widget child) => Card(
      color: C.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: C.border, width: 0.5)),
      child: Padding(padding: const EdgeInsets.all(14), child: child));

  Widget _label(String t) => Padding(
      padding: const EdgeInsets.only(top: 16, bottom: 8),
      child: Text(t, style: const TextStyle(color: C.textHint, fontSize: 11, letterSpacing: 0.6)));

  Widget _relativesTab(String myCode) {
    final d = _data;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        _card(Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Your ID code', style: TextStyle(color: C.textSecondary, fontSize: 12)),
            const SizedBox(height: 4),
            Text(myCode.isEmpty ? '—' : myCode, style: const TextStyle(color: C.textPrimary, fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: 1)),
            const SizedBox(height: 4),
            const Text('Share this with a family member so they can add you.', style: TextStyle(color: C.textHint, fontSize: 11)),
          ])),
          IconButton(
            icon: const Icon(Icons.copy, color: C.textSecondary),
            onPressed: myCode.isEmpty ? null : () { Clipboard.setData(ClipboardData(text: myCode)); _toast('ID code copied'); },
          ),
        ])),
        _label('ADD A RELATIVE'),
        _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          TextField(
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Their ID code', hintText: 'RR-000012', border: OutlineInputBorder()),
            onSubmitted: (_) => _add(),
          ),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: ElevatedButton.icon(
            onPressed: _busy ? null : _add,
            icon: const Icon(Icons.person_add, size: 18),
            label: const Text('Send request'),
          )),
          const SizedBox(height: 6),
          const Text('They get a notification and must accept before they can be alerted.', style: TextStyle(color: C.textHint, fontSize: 11)),
        ])),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: C.textRed, fontSize: 12))),
        if (d != null && d.incoming.isNotEmpty) ...[
          _label('REQUESTS FOR YOU'),
          for (final r in d.incoming) _card(Row(children: [
            const Icon(Icons.person_add_alt_1, color: C.amber),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r.name, style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w500)),
              Text('${r.uniqueId} wants to add you', style: const TextStyle(color: C.textHint, fontSize: 11)),
            ])),
            IconButton(tooltip: 'Reject', icon: const Icon(Icons.close, color: C.textRed), onPressed: _busy ? null : () => _run(() async { await _svc.reject(r.id); return 'Request rejected'; })),
            IconButton(tooltip: 'Accept', icon: const Icon(Icons.check_circle, color: C.green), onPressed: _busy ? null : () => _run(() async { await _svc.accept(r.id); return '${r.name} added as a relative'; })),
          ])),
        ],
        _label('YOUR RELATIVES'),
        if (d == null) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()))
        else if (d.accepted.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No relatives yet. Add one with their ID code above.', style: TextStyle(color: C.textHint, fontSize: 12)))
        else for (final r in d.accepted) _card(Row(children: [
          CircleAvatar(backgroundColor: C.red, child: Text(r.name.isNotEmpty ? r.name[0].toUpperCase() : '?', style: const TextStyle(color: Colors.white))),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.name, style: const TextStyle(color: C.textPrimary, fontWeight: FontWeight.w500)),
            Text(r.uniqueId, style: const TextStyle(color: C.textHint, fontSize: 11)),
          ])),
          if (r.phone.isNotEmpty) IconButton(tooltip: 'Call', icon: const Icon(Icons.phone, color: C.green), onPressed: () => _open('tel:${r.phone}')),
          IconButton(tooltip: 'Remove', icon: const Icon(Icons.person_remove, color: C.textSecondary), onPressed: _busy ? null : () => _confirmRemove(r)),
        ])),
        if (d != null && d.outgoing.isNotEmpty) ...[
          _label('WAITING FOR THEM TO ACCEPT'),
          for (final r in d.outgoing) _card(Row(children: [
            const Icon(Icons.hourglass_top, color: C.textSecondary),
            const SizedBox(width: 10),
            Expanded(child: Text('${r.name} (${r.uniqueId})', style: const TextStyle(color: C.textPrimary))),
            TextButton(onPressed: _busy ? null : () => _run(() async { await _svc.remove(r.id); return 'Request cancelled'; }), child: const Text('Cancel')),
          ])),
        ],
        const SizedBox(height: 24),
      ]),
    );
  }

  Future<void> _confirmRemove(RelativeItem r) async {
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      backgroundColor: C.card,
      title: Text('Remove ${r.name}?'),
      content: const Text('You will no longer be alerted when they send an SOS, and they will not be alerted for you.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remove')),
      ],
    ));
    if (ok == true) await _run(() async { await _svc.remove(r.id); return '${r.name} removed'; });
  }

  Widget _alertsTab() {
    if (_alerts.isEmpty) {
      return RefreshIndicator(onRefresh: _load, child: ListView(children: const [
        SizedBox(height: 120),
        Center(child: Text('No alerts yet.', style: TextStyle(color: C.textHint))),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        for (final a in _alerts) _alertCard(a),
      ]),
    );
  }

  Widget _alertCard(AppNotification a) {
    final sos = a.type == 'sos';
    final mapUrl = '${a.data['mapUrl'] ?? ''}';
    final phone = '${a.data['phone'] ?? ''}';
    final t = a.createdAt;
    return Card(
      color: sos ? const Color(0xFF2A1215) : C.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: sos ? C.redDark : C.border, width: 0.8)),
      child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(sos ? Icons.warning_amber_rounded : Icons.notifications, color: sos ? C.textRed : C.amber, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Text(a.title, style: TextStyle(color: C.textPrimary, fontWeight: a.read ? FontWeight.w400 : FontWeight.w600))),
          if (!a.read) const Icon(Icons.circle, color: C.red, size: 8),
        ]),
        const SizedBox(height: 6),
        Text(a.body, style: const TextStyle(color: C.textSecondary, fontSize: 12)),
        if (t != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(
            '${t.day.toString().padLeft(2, '0')}/${t.month.toString().padLeft(2, '0')} ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}',
            style: const TextStyle(color: C.textHint, fontSize: 10))),
        if ((sos || a.type.startsWith('emergency_')) && '${a.data['emergencyId'] ?? ''}'.isNotEmpty) Padding(
          padding: const EdgeInsets.only(top: 10),
          child: SizedBox(width: double.infinity, child: ElevatedButton.icon(
            onPressed: () => PushService.openEmergency('${a.data['emergencyId']}'),
            icon: const Icon(Icons.track_changes, size: 18),
            label: const Text('Track emergency'),
          )),
        ),
        if (sos && (mapUrl.isNotEmpty || phone.isNotEmpty)) Padding(padding: const EdgeInsets.only(top: 10), child: Row(children: [
          if (mapUrl.isNotEmpty) Expanded(child: OutlinedButton.icon(onPressed: () => _open(mapUrl), icon: const Icon(Icons.map, size: 16), label: const Text('Open location'))),
          if (mapUrl.isNotEmpty && phone.isNotEmpty) const SizedBox(width: 8),
          if (phone.isNotEmpty) Expanded(child: OutlinedButton.icon(onPressed: () => _open('tel:$phone'), icon: const Icon(Icons.phone, size: 16), label: const Text('Call'))),
        ])),
      ])),
    );
  }
}
