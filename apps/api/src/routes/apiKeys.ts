import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { generateApiKeyController, listApiKeysController, revokeApiKeyController } from '../controllers/apiKeys';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

// All API key management requires JWT auth + IT_ADMIN/SUPERADMIN
router.use(authenticate, authorize(UserRole.IT_ADMIN, UserRole.SUPERADMIN));

router.post('/generate', generateApiKeyController);
router.get('/', listApiKeysController);
router.post('/:id/revoke', revokeApiKeyController);

export default router;
