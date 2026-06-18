import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getVendorSuggestions } from '../services/vendorMatchingService';
import prisma from '../config/database';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

// IMPORTANT: /suggestions must come BEFORE /:id to avoid route collision
router.get('/suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, limit } = req.query;
    const suggestions = await getVendorSuggestions(
      search as string || '',
      limit ? parseInt(limit as string) : 5
    );
    res.json(suggestions);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendors = await prisma.vendor.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(vendors);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
    });
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    res.json(vendor);
  } catch (error) {
    next(error);
  }
});

router.post('/', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.create({
      data: req.body,
    });
    res.status(201).json(vendor);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(vendor);
  } catch (error) {
    next(error);
  }
});

export default router;
