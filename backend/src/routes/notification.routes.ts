import { Router } from 'express';
import * as R from '../controllers/relative.controller';
import { protect } from '../middleware/auth';
const r = Router();
r.use(protect);
r.get('/', R.listNotifications);
r.post('/read-all', R.markAllRead);
r.post('/token', R.saveToken);      // phone registers its FCM token after login
r.delete('/token', R.clearToken);   // on logout
export default r;
