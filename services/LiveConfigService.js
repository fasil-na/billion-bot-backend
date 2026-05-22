import LiveConfig from '../models/LiveConfig.js';

export class LiveConfigService {
  static async getEnabledConfigs() {
    return await LiveConfig.find({ isEnabled: true });
  }
}
