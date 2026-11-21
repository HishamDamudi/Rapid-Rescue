import { Router } from 'express';
import * as R from '../controllers/relative.controller';
import { protect } from '../middleware/auth';
const r = Router();
r.use(protect);
r.get('/', R.listRelatives);
r.post('/request', R.sendRequest);          // body: { uniqueId: 'RR-000012' }
r.post('/:id/accept', R.acceptRequest);
r.post('/:id/reject', R.rejectRequest);
r.delete('/:id', R.removeRelative);
export default r;
