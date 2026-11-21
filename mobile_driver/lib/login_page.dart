import 'package:flutter/material.dart';
import 'core/theme.dart';
import 'api.dart';
import 'config.dart';
import 'home_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _user = TextEditingController(), _pw = TextEditingController();
  bool _loading = false, _hide = true;
  String? _error;

  Future<void> _login() async {
    if (_user.text.trim().isEmpty || _pw.text.isEmpty) { setState(() => _error = 'Enter username and password'); return; }
    setState(() { _loading = true; _error = null; });
    try {
      await Api.login(_user.text, _pw.text);
      if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomePage()));
    } on ApiError catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.message; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 72, height: 72, decoration: BoxDecoration(color: C.blue, borderRadius: BorderRadius.circular(18)),
            child: const Icon(Icons.local_taxi, color: Colors.white, size: 36)),
          const SizedBox(height: 16),
          const Text('RapidRescue Driver', style: TextStyle(color: C.textPrimary, fontSize: 24, fontWeight: FontWeight.w500)),
          const Text('Ambulance & police van login', style: TextStyle(color: C.textHint, fontSize: 13)),
          const SizedBox(height: 28),
          TextField(controller: _user, textCapitalization: TextCapitalization.characters, textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Username (e.g. AMB-001)', prefixIcon: Icon(Icons.badge))),
          const SizedBox(height: 14),
          TextField(controller: _pw, obscureText: _hide, onSubmitted: (_) => _login(),
            decoration: InputDecoration(labelText: 'Password', prefixIcon: const Icon(Icons.lock),
              suffixIcon: IconButton(icon: Icon(_hide ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _hide = !_hide)))),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: C.textRed, fontSize: 12))),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _loading ? null : _login,
            child: _loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Log in'))),
          serverButton(context, () => setState(() {})),
          const Text('Credentials are issued by the admin.', style: TextStyle(color: C.textHint, fontSize: 11)),
        ])))),
      );
}
