import mongoose from 'mongoose';

const { Schema } = mongoose;

const reportSchema = new Schema({
  user: { 
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  issueType: {
    type: String,
    enum: ['Pothole','Streetlight','Graffiti','Other'],
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],   // [longitude, latitude]
      required: true
    }
  },
  address: {
    type: String,
    required: true            
  },
  description: {
    type: String,
    maxlength: 500,
    required: true
  },
  imageUrls: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['Pending','In Progress','Fixed','Rejected'],
    default: 'Pending'
  },
  rejectReason: {
    type: String  
  }
}, { timestamps: true });

reportSchema.index({ location: '2dsphere' });

export default mongoose.model('Report', reportSchema);
