import LiveConfig from '../models/LiveConfig.js';

export const createConfig = async (req, res) => {
  try {
    const newConfig = new LiveConfig(req.body);
    const savedConfig = await newConfig.save();
    res.status(201).json(savedConfig);
  } catch (error) {
    res.status(500).json({ message: 'Error creating config', error: error.message });
  }
};

export const getConfigs = async (req, res) => {
  try {
    const configs = await LiveConfig.find().sort({ createdAt: -1 });
    res.status(200).json(configs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching configs', error: error.message });
  }
};

export const updateConfig = async (req, res) => {
  try {
    const updatedConfig = await LiveConfig.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedConfig) return res.status(404).json({ message: 'Config not found' });
    res.status(200).json(updatedConfig);
  } catch (error) {
    res.status(500).json({ message: 'Error updating config', error: error.message });
  }
};

export const deleteConfig = async (req, res) => {
  try {
    const deletedConfig = await LiveConfig.findByIdAndDelete(req.params.id);
    if (!deletedConfig) return res.status(404).json({ message: 'Config not found' });
    res.status(200).json({ message: 'Config deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting config', error: error.message });
  }
};
