import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getVendorSuggestions } from '../services/vendorMatchingService';
import { UserRole } from '@ap-invoice/shared';

const router = Router();

router.use(authenticate);

router.get('/suggestions', async (req, res, next) => {
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

export default router;
