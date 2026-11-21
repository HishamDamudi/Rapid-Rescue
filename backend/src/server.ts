import 'dotenv/config';
import http from 'http';
import app from './app';
import { connectDB } from './config/database';
import { initSocket } from './sockets';
import logger from './utils/logger';
import User from './models/User';
import Vehicle from './models/Vehicle';
import HospitalOffer from './models/HospitalOffer';
import { startSweeper } from './services/DispatchService';

async function bootstrap() {
  await connectDB();
  // Old DBs have a non-sparse unique email index -> 2nd citizen without email fails with "email already exists". Rebuild indexes to match the schema.
  await User.syncIndexes().catch(e => logger.warn('User index sync failed', e));
  await Vehicle.syncIndexes().catch(e => logger.warn('Vehicle index sync failed', e));
  await HospitalOffer.syncIndexes().catch(e => logger.warn('HospitalOffer index sync failed', e));
  const server = http.createServer(app);
  initSocket(server);
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => logger.info(`RapidRescue API :${PORT}`));
  startSweeper();   // delayed auto-dispatch, ambulance retry, hospital-offer timeouts
}
bootstrap().catch(e => { console.error(e); process.exit(1); });
