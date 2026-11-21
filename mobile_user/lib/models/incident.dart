class Incident {
  String id, incidentId, type, status, description, trigger;
  double lat, lng;
  String bloodType, emergencyContactName, emergencyContactPhone, medicalNotes;
  Map<String, dynamic>? sensorData;
  DateTime? createdAt;

  Incident({
    required this.id, required this.incidentId, required this.type, required this.status,
    this.description = '', this.trigger = 'manual', required this.lat, required this.lng,
    this.bloodType = '', this.emergencyContactName = '', this.emergencyContactPhone = '',
    this.medicalNotes = '', this.sensorData, this.createdAt,
  });

  factory Incident.fromJson(Map<String, dynamic> j) => Incident(
        id: j['_id'] ?? j['id'] ?? '',
        incidentId: j['incidentId'] ?? '',
        type: j['type'] ?? 'other',
        status: j['status'] ?? 'reported',
        description: j['description'] ?? '',
        trigger: j['triggerSource'] ?? 'manual',
        lat: (j['location']?['lat'] ?? 0).toDouble(),
        lng: (j['location']?['lng'] ?? 0).toDouble(),
        bloodType: j['reporterBloodGroup'] ?? '',
        emergencyContactName: j['emergencyContactName'] ?? '',
        emergencyContactPhone: j['emergencyContactPhone'] ?? '',
        medicalNotes: j['reporterMedicalNotes'] ?? '',
        sensorData: j['sensorData'],
        createdAt: j['createdAt'] != null ? DateTime.tryParse(j['createdAt']) : null,
      );
}
