import express from 'express';
import {
  declareFinalPayment,
  getPublicSettlement,
  getSettlement,
  updateSettlement,
} from '../controllers/settlement.controller.js';
import {verifyToken} from '../middleware/auth.middleware.js';
import {handleSettlementError} from '../middleware/error.middleware.js';

const router = express.Router();

router.get('/:id/settlement', verifyToken, getSettlement);
router.get('/public/:token/settlement', getPublicSettlement);
router.patch('/:id/settlement', verifyToken, updateSettlement);
router.post('/public/:token/final-payment-declaration', declareFinalPayment);

router.use(handleSettlementError);

export default router;
