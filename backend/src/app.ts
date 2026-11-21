import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler, notFound } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import incidentRoutes from './routes/incident.routes';
import vehicleRoutes from './routes/vehicle.routes';
import directoryRoutes from './routes/directory.routes';
import relativeRoutes from './routes/relative.routes';
import notificationRoutes from './routes/notification.routes';
import emergencyRoutes from './routes/emergency.routes';

const app = express();
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.get('/health', (_q, s) => s.json({ status: 'ok' }));

const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/incidents`, incidentRoutes);
app.use(`${API}/vehicles`, vehicleRoutes);
app.use(`${API}/directory`, directoryRoutes);
app.use(`${API}/relatives`, relativeRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/emergency`, emergencyRoutes);

app.use(notFound);
app.use(errorHandler);
export default app;
