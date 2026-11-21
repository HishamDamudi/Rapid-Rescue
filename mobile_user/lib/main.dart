import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/constants.dart';
import 'core/theme.dart';
import 'providers/auth_provider.dart';
import 'screens/router_screen.dart';
import 'services/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.load();
  await PushService.init(); // no-op (push off) until google-services.json is added
  runApp(const RapidRescueApp());
}

class RapidRescueApp extends StatelessWidget {
  const RapidRescueApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthProvider()..init(),
      child: MaterialApp(
        title: 'RapidRescue',
        navigatorKey: PushService.navigatorKey,
        scaffoldMessengerKey: PushService.messengerKey,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark,
        home: const RouterScreen(),
      ),
    );
  }
}