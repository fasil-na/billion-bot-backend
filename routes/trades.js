import express from 'express';
import { getTrades } from '../controllers/tradeController.js';

const router = express.Router();

router.get('/', getTrades);

export default router;
