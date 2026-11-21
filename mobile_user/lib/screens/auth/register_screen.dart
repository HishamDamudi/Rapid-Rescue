import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController(), _phone = TextEditingController(), _address = TextEditingController(),
      _pw = TextEditingController(), _notes = TextEditingController(), _ecName = TextEditingController(), _ecPhone = TextEditingController();
  static const _groups = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  String _blood = 'Unknown';
  bool _donor = false, _loading = false;
  String? _error;

  String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');

  Future<void> _register() async {
    final phone = _digits(_phone.text);
    String? bad;
    if (_name.text.trim().length < 2) bad = 'Enter your full name';
    else if (phone.length != 10) bad = 'Enter a valid 10-digit phone number';
    else if (_address.text.trim().length < 5) bad = 'Enter your address';
    else if (_pw.text.isNotEmpty && _pw.text.length < 6) bad = 'Password must be at least 6 characters';
    else if (_ecPhone.text.isNotEmpty && _digits(_ecPhone.text).length != 10) bad = 'Emergency contact phone must be 10 digits';
    if (bad != null) { setState(() => _error = bad); return; }
    setState(() { _loading = true; _error = null; });
    final err = await context.read<AuthProvider>().register({
      'name': _name.text.trim(), 'phone': phone, 'address': _address.text.trim(),
      if (_pw.text.isNotEmpty) 'password': _pw.text, // empty -> backend uses phone number
      'bloodGroup': _blood, 'organDonor': _donor, 'medicalNotes': _notes.text.trim(),
      if (_ecPhone.text.isNotEmpty) 'emergencyContact': {'name': _ecName.text.trim(), 'phone': _digits(_ecPhone.text), 'relation': 'Family'},
    });
    if (!mounted) return;
    setState(() { _loading = false; _error = err; });
    if (err == null) Navigator.of(context).popUntil((r) => r.isFirst); // router now shows Home
  }

  Widget _f(TextEditingController c, String label, {TextInputType? type, int? max, bool obscure = false, String? helper, int lines = 1}) =>
      Padding(padding: const EdgeInsets.only(bottom: 14), child: TextField(controller: c, keyboardType: type, maxLength: max,
        obscureText: obscure, maxLines: lines, decoration: InputDecoration(labelText: label, helperText: helper, counterText: '')));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register (one time)'), actions: [IconButton(icon: const Icon(Icons.dns), tooltip: 'Server', onPressed: () => showServerDialog(context))]),
      body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _f(_name, 'Full name *'),
        _f(_phone, 'Phone number *', type: TextInputType.phone, max: 10),
        _f(_address, 'Address *', lines: 2),
        _f(_pw, 'Password (optional)', obscure: true, helper: 'Leave empty to use your phone number as password'),
        DropdownButtonFormField<String>(value: _blood, dropdownColor: C.card, decoration: const InputDecoration(labelText: 'Blood group'),
          items: _groups.map((g) => DropdownMenuItem(value: g, child: Text(g))).toList(), onChanged: (v) => setState(() => _blood = v!)),
        const SizedBox(height: 14),
        _f(_notes, 'Medical notes / allergies', lines: 2),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Organ donor'), value: _donor, onChanged: (v) => setState(() => _donor = v)),
        const Text('Emergency contact', style: TextStyle(color: C.textSecondary)),
        const SizedBox(height: 8),
        _f(_ecName, 'Contact name'),
        _f(_ecPhone, 'Contact phone', type: TextInputType.phone, max: 10),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: C.textRed))),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _loading ? null : _register,
          child: _loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Register'))),
      ]))),
    );
  }
}
