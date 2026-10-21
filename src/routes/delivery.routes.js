import express from 'express';
import {
  getDelivery,
  getPublicDelivery,
  updateDelivery,
} from '../controllers/delivery.controller.js';
import {verifyToken} from '../middleware/auth.middleware.js';
import {handleDeliveryError} from '../middleware/error.middleware.js';

const router = express.Router();

router.get('/:id/delivery', verifyToken, getDelivery);
router.get('/public/:token/delivery', getPublicDelivery);
router.patch('/:id/delivery', verifyToken, updateDelivery);

router.use(handleDeliveryError);

export default router;
