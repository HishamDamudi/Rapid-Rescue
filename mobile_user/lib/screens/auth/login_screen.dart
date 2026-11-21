import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants.dart';
import '../../core/theme.dart';
import '../../providers/auth_provider.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _pw = TextEditingController();
  bool _loading = false, _hide = true;
  String? _error;

  Future<void> _login() async {
    final phone = _phone.text.replaceAll(RegExp(r'\D'), '');
    if (phone.length < 10) { setState(() => _error = 'Enter your 10-digit phone number'); return; }
    if (_pw.text.isEmpty) { setState(() => _error = 'Enter your password'); return; }
    setState(() { _loading = true; _error = null; });
    final err = await context.read<AuthProvider>().login(phone, _pw.text);
    if (mounted) setState(() { _loading = false; _error = err; });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: Center(child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 72, height: 72, decoration: BoxDecoration(color: C.red, borderRadius: BorderRadius.circular(18)),
            child: const Icon(Icons.emergency, color: Colors.white, size: 36)),
          const SizedBox(height: 16),
          const Text('RapidRescue', style: TextStyle(color: C.textPrimary, fontSize: 26, fontWeight: FontWeight.w500)),
          const Text('Welcome back', style: TextStyle(color: C.textHint, fontSize: 13)),
          const SizedBox(height: 28),
          TextField(controller: _phone, keyboardType: TextInputType.phone, maxLength: 10, textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Phone number', prefixIcon: Icon(Icons.phone), counterText: '')),
          const SizedBox(height: 14),
          TextField(controller: _pw, obscureText: _hide, onSubmitted: (_) => _login(),
            decoration: InputDecoration(labelText: 'Password', prefixIcon: const Icon(Icons.lock),
              helperText: 'Default password = your phone number',
              suffixIcon: IconButton(icon: Icon(_hide ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _hide = !_hide)))),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: C.textRed, fontSize: 12))),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity, child: ElevatedButton(
            onPressed: _loading ? null : _login,
            child: _loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Log in'))),
          TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
            child: const Text('New here? Register once')),
          serverButton(context, () => setState(() {})),
        ]),
      ))),
    );
  }
}
