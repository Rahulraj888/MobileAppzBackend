import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user','admin'],
    default: 'user'
  },
  mobile: {
    type: String,
    required: true,
    trim: true
  },
  bio: {
    type: String,
    trim: true,
    default: ''
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationTokenExpires: Date,
  verifiedAt: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date
}, {
  timestamps: { createdAt: 'createdAt' }
});

export default mongoose.model('User', userSchema);
