import 'package:flutter/material.dart';

class C {
  static const bg = Color(0xFF0D0D0F);
  static const card = Color(0xFF1A1A1F);
  static const border = Color(0xFF2A2A33);
  static const red = Color(0xFFD32F2F);
  static const redDark = Color(0xFFB71C1C);
  static const green = Color(0xFF4CAF50);
  static const greenDark = Color(0xFF2E7D32);
  static const amber = Color(0xFFFF9800);
  static const blue = Color(0xFF1565C0);
  static const blueLight = Color(0xFF90CAF9);
  static const police = Color(0xFF1B5E20);
  static const textPrimary = Color(0xFFF5F5F5);
  static const textSecondary = Color(0xFF9E9E9E);
  static const textHint = Color(0xFF616161);
  static const textRed = Color(0xFFEF5350); // readable red for emphasis/danger text on dark bg
}
class AppTheme {
  static ThemeData get dark => ThemeData(
    brightness: Brightness.dark,
    scaffoldBackgroundColor: C.bg,
    primaryColor: C.red,
    colorScheme: ColorScheme.fromSeed(
      seedColor: C.red,
      brightness: Brightness.dark,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: C.card,
      elevation: 0,
    ),
    cardColor: C.card,
  );
}
ThemeData appTheme() => ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: C.bg,
      primaryColor: C.red,
      fontFamily: 'Roboto',
      appBarTheme: const AppBarTheme(backgroundColor: C.card, elevation: 0),
      cardColor: C.card,
      colorScheme: ColorScheme.fromSeed(seedColor: C.red, brightness: Brightness.dark),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: C.bg,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: C.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: C.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: C.red)),
        labelStyle: const TextStyle(color: C.textSecondary),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: C.red, foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
    );
