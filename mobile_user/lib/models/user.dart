class EmergencyContact {
  String name, phone, relation;
  bool notifyOnSOS;
  EmergencyContact({required this.name, required this.phone, this.relation = 'Other', this.notifyOnSOS = true});
  factory EmergencyContact.fromJson(Map<String, dynamic> j) => EmergencyContact(
      name: j['name'] ?? '', phone: j['phone'] ?? '', relation: j['relation'] ?? 'Other', notifyOnSOS: j['notifyOnSOS'] ?? true);
  Map<String, dynamic> toJson() => {'name': name, 'phone': phone, 'relation': relation, 'notifyOnSOS': notifyOnSOS};
}

class AppUser {
  String id, uniqueId, name, email, phone, address, role, bloodGroup, medicalNotes, qrCode;
  bool organDonor;
  List<String> allergies, medicalConditions;
  List<EmergencyContact> emergencyContacts;

  AppUser({
    required this.id, required this.uniqueId, required this.name, required this.email,
    this.phone = '', this.address = '', this.role = 'citizen', this.bloodGroup = 'Unknown', this.medicalNotes = '',
    this.qrCode = '', this.organDonor = false, this.allergies = const [], this.medicalConditions = const [],
    this.emergencyContacts = const [],
  });

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: j['id'] ?? j['_id'] ?? '',
        uniqueId: j['uniqueId'] ?? '',
        name: j['name'] ?? '',
        email: j['email'] ?? '',
        phone: j['phone'] ?? '',
        address: j['address'] ?? '',
        role: j['role'] ?? 'citizen',
        bloodGroup: j['bloodGroup'] ?? 'Unknown',
        medicalNotes: j['medicalNotes'] ?? '',
        qrCode: j['qrCode'] ?? '',
        organDonor: j['organDonor'] ?? false,
        allergies: List<String>.from(j['allergies'] ?? []),
        medicalConditions: List<String>.from(j['medicalConditions'] ?? []),
        emergencyContacts: (j['emergencyContacts'] as List? ?? []).map((e) => EmergencyContact.fromJson(e)).toList(),
      );
}
