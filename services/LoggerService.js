import { SystemLog } from "../models/SystemLog.js";

export class LoggerService {
  static setBroadcaster(broadcaster) {
    this.broadcaster = broadcaster;
  }
  
  static async log(level, message, context, data) {
    console.log(`[${level.toUpperCase()}] ${context}: ${message}`, data || '');
    if (this.broadcaster) {
      this.broadcaster({ level, message, context, data, timestamp: new Date() });
    }

    if (level === 'error' || level === 'imp') {
      try {
        await SystemLog.create({ level, message, context, data });
      } catch (err) {
        console.error("Failed to save error log to DB:", err.message);
      }
    }
  }
}
