import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _editMode = false;
  bool _saving = false;
  late TextEditingController _name, _phone, _notes, _ecName, _ecPhone;
  String _blood = 'O+';
  bool _donor = false;
  final _bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'];

  @override
  void initState() {
    super.initState();
    final u = context.read<AuthProvider>().user;
    _name = TextEditingController(text: u?.name ?? '');
    _phone = TextEditingController(text: u?.phone ?? '');
    _notes = TextEditingController(text: u?.medicalNotes ?? '');
    _ecName = TextEditingController(text: u?.emergencyContacts.isNotEmpty == true ? u!.emergencyContacts.first.name : '');
    _ecPhone = TextEditingController(text: u?.emergencyContacts.isNotEmpty == true ? u!.emergencyContacts.first.phone : '');
    _blood = u?.bloodGroup ?? 'O+';
    _donor = u?.organDonor ?? false;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    await context.read<AuthProvider>().updateProfile({
      'name': _name.text, 'phone': _phone.text, 'bloodGroup': _blood,
      'organDonor': _donor, 'medicalNotes': _notes.text,
      'emergencyContacts': [{'name': _ecName.text, 'phone': _ecPhone.text, 'relation': 'Family', 'notifyOnSOS': true}],
    });
    setState(() { _saving = false; _editMode = false; });
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Profile saved'), backgroundColor: C.greenDark));
  }

  @override
  Widget build(BuildContext context) {
    final u = context.watch<AuthProvider>().user;
    return Scaffold(
      appBar: AppBar(title: const Text('Emergency profile'), actions: [
        TextButton(onPressed: () => setState(() => _editMode = !_editMode), child: Text(_editMode ? 'Cancel' : 'Edit', style: const TextStyle(color: C.red))),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(color: C.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: C.border, width: 0.5)),
          child: Padding(padding: const EdgeInsets.all(14), child: Row(children: [
            CircleAvatar(radius: 24, backgroundColor: C.red, child: Text(u?.name.isNotEmpty == true ? u!.name[0] : '?', style: const TextStyle(color: Colors.white, fontSize: 18))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(u?.name ?? '', style: const TextStyle(color: C.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
              Text(u?.phone ?? '', style: const TextStyle(color: C.textHint, fontSize: 12)),
            ])),
            Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), decoration: BoxDecoration(color: C.bg, borderRadius: BorderRadius.circular(6), border: Border.all(color: C.border)),
              child: Text(u?.uniqueId ?? '', style: const TextStyle(color: C.textHint, fontSize: 11, fontFamily: 'monospace'))),
          ]))),
        const SizedBox(height: 14),
        if (_editMode) ..._editForm() else ..._viewMode(u),
      ]),
    );
  }

  List<Widget> _viewMode(dynamic u) => [
    _sectionCard('Personal info', [
      _row('Phone', u?.phone ?? '–'),
      _row('Blood type', u?.bloodGroup ?? '–'),
      _row('Organ donor', (u?.organDonor ?? false) ? 'Yes' : 'No'),
    ]),
    _sectionCard('Emergency contact', [
      _row('Name', u?.emergencyContacts.isNotEmpty == true ? u.emergencyContacts.first.name : '–'),
      _row('Phone', u?.emergencyContacts.isNotEmpty == true ? u.emergencyContacts.first.phone : '–'),
    ]),
    _sectionCard('Medical notes', [
      Text(u?.medicalNotes?.isNotEmpty == true ? u.medicalNotes : 'None provided.', style: const TextStyle(color: C.textSecondary, fontSize: 13)),
    ]),
  ];

  List<Widget> _editForm() => [
    TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name *')),
    const SizedBox(height: 12),
    TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone *')),
    const SizedBox(height: 12),
    DropdownButtonFormField<String>(
      value: _bloodTypes.contains(_blood) ? _blood : 'Unknown',
      decoration: const InputDecoration(labelText: 'Blood type *'),
      items: _bloodTypes.map((b) => DropdownMenuItem(value: b, child: Text(b))).toList(),
      onChanged: (v) => setState(() => _blood = v ?? 'Unknown'),
    ),
    SwitchListTile(title: const Text('Organ donor', style: TextStyle(color: C.textSecondary)), value: _donor, onChanged: (v) => setState(() => _donor = v), activeColor: C.green),
    const SizedBox(height: 8),
    TextField(controller: _ecName, decoration: const InputDecoration(labelText: 'Emergency contact name *')),
    const SizedBox(height: 12),
    TextField(controller: _ecPhone, decoration: const InputDecoration(labelText: 'Emergency contact phone *')),
    const SizedBox(height: 12),
    TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Medical notes'), maxLines: 4),
    const SizedBox(height: 20),
    SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _saving ? null : _save,
      child: _saving ? const CircularProgressIndicator(color: Colors.white) : const Text('Save changes'))),
  ];

  Widget _sectionCard(String title, List<Widget> children) => Padding(padding: const EdgeInsets.only(bottom: 14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(title.toUpperCase(), style: const TextStyle(color: C.textHint, fontSize: 11, letterSpacing: 0.6)),
    const SizedBox(height: 8),
    Card(color: C.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: C.border, width: 0.5)),
      child: Padding(padding: const EdgeInsets.all(14), child: Column(children: children))),
  ]));

  Widget _row(String label, String value) => Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
    Text(label, style: const TextStyle(color: C.textHint, fontSize: 13)),
    Text(value, style: const TextStyle(color: C.textPrimary, fontSize: 13)),
  ]));
}
