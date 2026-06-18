import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { startEmailPoller } from '../services/emailIntakeService';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.post('/start-poller', authorize(UserRole.IT_ADMIN), async (req, res, next) => {
  try {
    const { interval } = req.body;
    const intervalMinutes = interval || 5;
    
    startEmailPoller(intervalMinutes);
    
    res.json({ 
      success: true, 
      message: `Email poller started with ${intervalMinutes} minute interval` 
    });
  } catch (error) {
    next(error);
  }
});

export default router;
