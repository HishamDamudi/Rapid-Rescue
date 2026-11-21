import 'package:flutter/material.dart';
import 'config.dart';
import 'core/theme.dart';
import 'api.dart';
import 'login_page.dart';
import 'home_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.load();
  runApp(const DriverApp());
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'RapidRescue Driver',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark,
        home: FutureBuilder<bool>(
          future: Api.hasSession(),
          builder: (c, s) => s.connectionState != ConnectionState.done
              ? const Scaffold(body: Center(child: CircularProgressIndicator()))
              : (s.data == true ? const HomePage() : const LoginPage()),
        ),
      );
}
