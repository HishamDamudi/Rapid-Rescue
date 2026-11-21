import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;
import '../core/constants.dart';
import '../core/theme.dart';

class MumbaiMap extends StatelessWidget {
  final double? userLat, userLng;
  final bool showHospitals;
  final List<Map<String, double>> sosPins;
  const MumbaiMap({super.key, this.userLat, this.userLng, this.showHospitals = true, this.sosPins = const []});

  @override
  Widget build(BuildContext context) {
    final center = userLat != null && userLng != null
        ? ll.LatLng(userLat!, userLng!)
        : ll.LatLng(Mumbai.lat, Mumbai.lng);

    return FlutterMap(
      options: MapOptions(initialCenter: center, initialZoom: userLat != null ? 13 : 11),
      children: [
        TileLayer(urlTemplate: Mumbai.tileUrl, userAgentPackageName: 'com.rapidrescue.app'),
        MarkerLayer(markers: [
          if (userLat != null && userLng != null)
            Marker(point: ll.LatLng(userLat!, userLng!), width: 24, height: 24,
              child: Container(decoration: BoxDecoration(shape: BoxShape.circle, color: C.blueLight, border: Border.all(color: Colors.white, width: 2)))),
          if (showHospitals)
            ...Hospitals.list.map((h) => Marker(
                  point: ll.LatLng(h['lat'] as double, h['lng'] as double),
                  width: 30, height: 30,
                  child: const Icon(Icons.local_hospital, color: C.red, size: 28),
                )),
          ...sosPins.map((p) => Marker(
                point: ll.LatLng(p['lat']!, p['lng']!),
                width: 30, height: 30,
                child: const Icon(Icons.warning, color: Colors.redAccent, size: 30),
              )),
        ]),
      ],
    );
  }
}
