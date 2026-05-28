import { SystemLog } from '../models/SystemLog.js';

export const getLogs = async (req, res) => {
    try {
        const { limit = 100, page = 1 } = req.query;
        
        const logs = await SystemLog.find()
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));
            
        const total = await SystemLog.countDocuments();
        
        res.json({
            logs,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const clearLogs = async (req, res) => {
    try {
        await SystemLog.deleteMany({});
        res.json({ message: 'All logs cleared successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
