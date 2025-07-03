import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', required: true },
  text:   { type: String, required: true, maxlength: 300 }
}, { timestamps: true });

export default mongoose.model('Comment', commentSchema);
