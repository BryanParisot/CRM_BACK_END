import express from 'express';
import {
  createYoutrustSignature,
  receiveYoutrustWebhook,
  syncYoutrustSignature,
} from '../controllers/youtrust.controller.js';
import {verifyToken} from '../middleware/auth.middleware.js';

export const youtrustRouter = express.Router();

youtrustRouter.post('/:id/youtrust', verifyToken, createYoutrustSignature);
youtrustRouter.post('/:id/youtrust/sync', verifyToken, syncYoutrustSignature);

// Ce routeur reste monté avant express.json() pour vérifier le HMAC du corps brut.
export const youtrustWebhookRouter = express.Router();

youtrustWebhookRouter.post('/', express.raw({type: 'application/json', limit: '1mb'}), receiveYoutrustWebhook);
