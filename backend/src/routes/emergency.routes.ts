import { Router } from 'express';
import * as E from '../controllers/emergency.controller';
import { protect, authorize } from '../middleware/auth';

const r = Router();
r.use(protect);

// order matters: fixed paths before "/:id"
r.get('/active', E.activeForMe);
r.get('/police/vans', authorize('police_staff'), E.policeVans);

r.get('/:id', E.track);                                                               // role-filtered tracking view
r.post('/:id/acknowledge', authorize('citizen'), E.acknowledge);                      // relative
r.post('/:id/cancel', authorize('citizen'), E.patientCancel);                         // patient: "I'm safe"
r.post('/:id/hospital/accept', authorize('hospital_staff'), E.hospitalAccept);
r.post('/:id/hospital/reject', authorize('hospital_staff'), E.hospitalReject);
r.post('/:id/hospital/ot-ready', authorize('hospital_staff'), E.hospitalOtReady);
r.post('/:id/police/acknowledge', authorize('police_staff'), E.policeAcknowledge);
r.post('/:id/police/dispatch', authorize('police_staff'), E.policeDispatch);
export default r;
