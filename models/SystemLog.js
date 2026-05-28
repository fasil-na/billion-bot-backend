import mongoose from "mongoose";

const systemLogSchema = new mongoose.Schema(
  {
    level: { type: String, required: true },
    message: { type: String, required: true },
    context: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const SystemLog = mongoose.model("SystemLog", systemLogSchema);
