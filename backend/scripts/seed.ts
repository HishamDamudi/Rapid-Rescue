import 'dotenv/config';
import mongoose from 'mongoose';
import { Hospital, PoliceStation } from '../src/models/index';
import Vehicle from '../src/models/Vehicle';
import User from '../src/models/User';

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI!);

  await Hospital.deleteMany({});
  const hospitals: any[] = await Hospital.insertMany([
    { name: 'KEM Hospital', phone: '+912224136051', location: { lat: 19.0004, lng: 72.8397 }, availableEmergencyBeds: 12 },
    { name: 'Hinduja Hospital', phone: '+912224445000', location: { lat: 19.0535, lng: 72.8397 }, availableEmergencyBeds: 8 },
    { name: 'Lilavati Hospital', phone: '+912226751000', location: { lat: 19.0607, lng: 72.8313 }, availableEmergencyBeds: 5, otAvailable: 2, address: 'Bandra Reclamation, Bandra (W), Mumbai', specialties: ['Cardiology', 'Neurology', 'Trauma'] },
    { name: 'Bombay Hospital', phone: '+912222067676', location: { lat: 18.9392, lng: 72.8353 }, availableEmergencyBeds: 9, otAvailable: 3, address: 'New Marine Lines, Mumbai', specialties: ['Cardiology', 'Trauma'] },
    { name: 'Nanavati Hospital', phone: '+912226182222', location: { lat: 19.0893, lng: 72.8396 }, availableEmergencyBeds: 7, otAvailable: 2, address: 'Vile Parle (W), Mumbai', specialties: ['Orthopaedics', 'Neurology'] },
    { name: 'Kokilaben Hospital', phone: '+912230999999', location: { lat: 19.1302, lng: 72.8309 }, availableEmergencyBeds: 11, otAvailable: 4, address: 'Andheri (W), Mumbai', specialties: ['Trauma', 'Cardiology', 'Stroke'] },
    // Ghatkopar-area hospitals (coordinates approximate — adjust if you have exact addresses)
    { name: 'Rajawadi Municipal Hospital', phone: '+912225010000', location: { lat: 19.0890, lng: 72.9070 }, availableEmergencyBeds: 10, address: 'Rajawadi, Ghatkopar (W), Mumbai' },
    { name: 'Sarvodaya Hospital', phone: '+912221020000', location: { lat: 19.0835, lng: 72.9085 }, availableEmergencyBeds: 15, address: 'LBS Marg, Ghatkopar (W), Mumbai' },
    { name: 'Shantiniketan Hospital', phone: '+912225150000', location: { lat: 19.0825, lng: 72.9090 }, availableEmergencyBeds: 6, address: 'Near Shreyas Cinema, LBS Road, Ghatkopar (W), Mumbai' },
    { name: 'Mumbai Eye Care Cornea & Lasik Centre', phone: '+912225250000', location: { lat: 19.0870, lng: 72.9150 }, availableEmergencyBeds: 2, address: 'Ghatkopar (E), Mumbai', emergencyCapable: false },   // specialist clinic: never recommended for emergencies
  ]);

  await PoliceStation.deleteMany({});
  const stations: any[] = await PoliceStation.insertMany([
    { name: 'Dadar Police Station', phone: '+912224152000', location: { lat: 19.0178, lng: 72.8478 } },
    { name: 'Bandra Police Station', phone: '+912226423001', location: { lat: 19.0542, lng: 72.8361 } },
    // coordinates approximate — adjust to the real station
    { name: 'Ghatkopar Police Station', phone: '+912225011234', location: { lat: 19.0860, lng: 72.9080 } },
  ]);

  await Vehicle.deleteMany({});
  await Vehicle.create([
    { loginId: 'AMB-001', password: 'amb12345', registrationNumber: 'MH-01-AB-1234', type: 'ambulance', stationName: 'KEM Hospital', driverName: 'Rakesh Patil', currentLocation: { lat: 19.005, lng: 72.84, heading: 0, speed: 0, ts: new Date() } },
    { loginId: 'AMB-002', password: 'amb12345', registrationNumber: 'MH-01-AB-5678', type: 'ambulance', stationName: 'Hinduja Hospital', driverName: 'Suresh Naik' },
    { loginId: 'POL-001', password: 'pol12345', registrationNumber: 'MH-02-CD-1111', type: 'police_van', stationName: 'Dadar Police Station', driverName: 'Insp. Kamble' },
    { loginId: 'POL-002', password: 'pol12345', registrationNumber: 'MH-02-CD-2222', type: 'police_van', stationName: 'Bandra Police Station', driverName: 'SI Sharma' },
    // Ghatkopar-area units (an ambulance only gets auto-allocated while its driver app is open and reporting GPS)
    { loginId: 'AMB-003', password: 'amb12345', registrationNumber: 'MH-03-EF-3333', type: 'ambulance', stationName: 'Sarvodaya Hospital', driverName: 'Imran Shaikh', currentLocation: { lat: 19.0845, lng: 72.9060, heading: 0, speed: 0, ts: new Date() } },
    { loginId: 'POL-003', password: 'pol12345', registrationNumber: 'MH-03-GH-4444', type: 'police_van', stationName: 'Ghatkopar Police Station', driverName: 'API Deshmukh' },
  ]);

  await User.deleteMany({ phone: '9999999999' });
  await User.create({ name: 'Demo Citizen', phone: '9999999999', address: 'Dadar, Mumbai', password: '9999999999', role: 'citizen' });
  const hid = (n: string) => hospitals.find(h => h.name === n)?._id;
  const sid = (n: string) => stations.find(s => s.name === n)?._id;
  await User.deleteMany({ email: { $in: ['hishamdamudi123@gmail.com', 'mohammad.d@somaiya.edu', 'dispatcher@rapidrescue.app', 'rajawadi.staff@rapidrescue.app', 'police.ghatkopar@rapidrescue.app', 'kem.staff@rapidrescue.app', 'hinduja.staff@rapidrescue.app', 'lilavati.staff@rapidrescue.app', 'bombay.staff@rapidrescue.app', 'nanavati.staff@rapidrescue.app', 'kokilaben.staff@rapidrescue.app'] } });
  await User.create([
    { name: 'Hisham Damudi', email: 'hishamdamudi123@gmail.com', password: 'Admin@123', role: 'admin' },
    // Hospital staff are now LINKED to a hospital — that link decides which patient requests they receive.
    { name: 'Dr. Mohammad', email: 'mohammad.d@somaiya.edu', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Sarvodaya Hospital') },
    { name: 'Dr. Rajawadi Desk', email: 'rajawadi.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Rajawadi Municipal Hospital') },
    { name: 'KEM Hospital Desk', email: 'kem.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('KEM Hospital') },
    { name: 'Hinduja Hospital Desk', email: 'hinduja.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Hinduja Hospital') },
    { name: 'Lilavati Hospital Desk', email: 'lilavati.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Lilavati Hospital') },
    { name: 'Bombay Hospital Desk', email: 'bombay.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Bombay Hospital') },
    { name: 'Nanavati Hospital Desk', email: 'nanavati.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Nanavati Hospital') },
    { name: 'Kokilaben Hospital Desk', email: 'kokilaben.staff@rapidrescue.app', password: 'Hospital@123', role: 'hospital_staff', associatedHospital: hid('Kokilaben Hospital') },
    { name: 'Dispatch Desk', email: 'dispatcher@rapidrescue.app', password: 'Dispatch@123', role: 'dispatcher' },
    { name: 'Insp. Ghatkopar Desk', email: 'police.ghatkopar@rapidrescue.app', password: 'Police@123', role: 'police_staff', associatedPoliceStation: sid('Ghatkopar Police Station') },
  ]);

  console.log('Seeded: hospitals, police stations, vehicle logins (AMB-001/amb12345, POL-001/pol12345), staff users.');
  console.log('Hospital dashboards (web portal, password Hospital@123): kem / hinduja / lilavati / bombay / nanavati / kokilaben .staff@rapidrescue.app');
  console.log('Hospital staff: mohammad.d@somaiya.edu → Sarvodaya | rajawadi.staff@rapidrescue.app → Rajawadi (both Hospital@123). Police: police.ghatkopar@rapidrescue.app / Police@123');
  process.exit(0);
}
seed().catch(e => { console.error(e); process.exit(1); });
