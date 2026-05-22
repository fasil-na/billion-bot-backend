export class LoggerService {
  static setBroadcaster(broadcaster) {
    this.broadcaster = broadcaster;
  }
  
  static async log(level, message, context, data) {
    console.log(`[${level.toUpperCase()}] ${context}: ${message}`, data || '');
    if (this.broadcaster) {
      this.broadcaster({ level, message, context, data, timestamp: new Date() });
    }
  }
}
