import { Router, Request, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { eventBroadcaster } from '../services/eventBroadcaster';

const router: Router = Router();

// SSE stream endpoint — real-time updates for all logged-in users
router.get('/stream', authenticate, (req: AuthRequest, res: Response) => {
  const roles = req.user?.role ? [req.user.role] : [];
  const userId = req.user?.id || 'unknown';
  eventBroadcaster.addClient(res, roles, userId);
});

export default router;
