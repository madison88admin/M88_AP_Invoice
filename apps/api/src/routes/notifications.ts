import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { inAppNotificationService } from '../services/inAppNotificationService';

const router: Router = Router();

router.use(authenticate);

// Get notifications for current user
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const notifications = await inAppNotificationService.getNotifications(req.user!.role, limit);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
});

// Get unread count
router.get('/unread-count', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await inAppNotificationService.getUnreadCount(req.user!.role);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

// Mark single notification as read
router.patch('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await inAppNotificationService.markAsRead(req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Mark all as read
router.patch('/mark-all-read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await inAppNotificationService.markAllAsRead(req.user!.role);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
