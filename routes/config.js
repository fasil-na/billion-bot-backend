import express from 'express';
import { createConfig, getConfigs, updateConfig, deleteConfig } from '../controllers/configController.js';

const router = express.Router();

router.post('/', createConfig);
router.get('/', getConfigs);
router.put('/:id', updateConfig);
router.delete('/:id', deleteConfig);

export default router;
