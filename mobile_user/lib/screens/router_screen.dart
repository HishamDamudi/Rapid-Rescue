import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import 'auth/login_screen.dart';
import 'citizen/home_screen.dart';

// Signed in once -> goes straight to Home on every launch. Login screen only after logout / expired session.
class RouterScreen extends StatelessWidget {
  const RouterScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (auth.loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return auth.user == null ? const LoginScreen() : const HomeScreen();
  }
}
