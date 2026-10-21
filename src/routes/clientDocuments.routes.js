import express from 'express';
import {
  declareDepositPayment,
  downloadClientDocument,
  downloadIdentityDocument,
  downloadPublicDocument,
  getClientDocuments,
  getPublicDocuments,
  saveCgvTemplate,
  saveClientDocument,
  saveIdentityDocument,
  updateDocumentSettings,
} from '../controllers/clientDocuments.controller.js';
import {verifyToken} from '../middleware/auth.middleware.js';
import {handleDocumentError} from '../middleware/error.middleware.js';

const router = express.Router();
const pdfBody = express.raw({type: 'application/pdf', limit: '10mb'});
const identityBody = express.raw({type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '10mb'});

router.put('/templates/cgv', verifyToken, pdfBody, saveCgvTemplate);
router.get('/:id/documents', verifyToken, getClientDocuments);
router.put('/:id/documents/:kind', verifyToken, pdfBody, saveClientDocument);
router.get('/:id/documents/:kind', verifyToken, downloadClientDocument);
router.patch('/:id/document-settings', verifyToken, updateDocumentSettings);
router.get('/public/:token/documents', getPublicDocuments);
router.get('/public/:token/documents/:kind', downloadPublicDocument);
router.put('/public/:token/identity/:kind', identityBody, saveIdentityDocument);
router.get('/:id/identity/:kind', verifyToken, downloadIdentityDocument);
router.post('/public/:token/payment-declaration', declareDepositPayment);

router.use(handleDocumentError);

export default router;
