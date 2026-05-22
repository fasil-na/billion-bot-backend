import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import marketRoutes from './routes/market.js';
import configRoutes from './routes/config.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected successfully'))
    .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.get('/api', (req, res) => {
    res.json({ message: 'Welcome to the API' });
});

app.use('/api/market', marketRoutes);
app.use('/api/configs', configRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
