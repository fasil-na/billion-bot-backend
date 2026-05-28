import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import marketRoutes from './routes/market.js';
import configRoutes from './routes/config.js';
import tradeRoutes from './routes/trades.js';
import logRoutes from './routes/logs.js';
import { SocketService } from './services/SocketService.js';

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('MongoDB connected successfully');
        SocketService.init(httpServer);
    })
    .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.get('/api', (req, res) => {
    res.json({ message: 'Welcome to the API' });
});

app.use('/api/market', marketRoutes);
app.use('/api/configs', configRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/logs', logRoutes);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
