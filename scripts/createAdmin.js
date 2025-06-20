require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('../models/User'); 

require('dotenv').config();
async function createAdmin() {
  try {
    //Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    //Check if admin already exists
    const existing = await User.findOne({ email: process.env.EMAIL });
    if (existing) {
      console.log('⚠️  Admin already exists');
      process.exit(0);
    }

    //Hash the password
    const salt     = await bcrypt.genSalt(10);
    const hashPass = await bcrypt.hash(process.env.PASSWORD, salt);

    //Create the admin user
    const admin = new User({
      name:       'Admin',
      email:      process.env.EMAIL,
      password:   hashPass,
      mobile:     '0000000000',
      isVerified: true,
      role:       'admin',
      createdAt:  Date.now()
    });

    await admin.save();
    console.log('🚀 Admin user created successfully');
  } catch (err) {
    console.error('❌ Error creating admin:', err);
  } finally {
    process.exit(0);
  }
}

createAdmin();
