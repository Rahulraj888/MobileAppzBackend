import express   from 'express';
import multer    from 'multer';
import path      from 'path';
import Report    from '../models/Report.js';
import User      from '../models/User.js';
import sendEmail from '../utils/sendEmail.js';
import auth      from '../middleware/authMiddleware.js';

const router = express.Router();

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }    // 5MB
});

// POST /api/reports
router.post(
  '/',
  auth,
  upload.array('images', 5),
  async (req, res) => {
    try {
      const { issueType, latitude, longitude, description, address } = req.body;
      const imageUrls = req.files.map(f => `/uploads/${f.filename}`);

      const report = new Report({
        user: req.user.id,
        issueType,
        location: {
          type: 'Point',
          coordinates: [ parseFloat(longitude), parseFloat(latitude) ]
        },
        address,          
        description,
        imageUrls
      });
      await report.save();

      // send confirmation email (fire-and-forget)
      const reporter = await User.findById(req.user.id).select('name email');
      if (reporter) {
        const html = `
          <h2>Thank you for reporting an issue!</h2>
          <p>Hi ${reporter.name},</p>
          <p>We’ve received your report of a <strong>${issueType}</strong>:</p>
          <ul>
            <li><strong>Description:</strong> ${description}</li>
            <li><strong>Location:</strong> (${latitude}, ${longitude})</li>
            <li><strong>Address:</strong> ${address}</li>
          </ul>
          <p>Our team will review it shortly.</p>
          <p>Thanks,<br/>The Mobile Appz Team</p>
        `;
        sendEmail({
          to: reporter.email,
          subject: 'Thank you for your report!',
          html
        }).catch(err => console.error('Error sending confirmation email:', err));
      }

      //Respond with the new report and a popup message
      res.status(201).json({
        report,
        msg: 'Thank you for reporting! A confirmation email has been sent.'
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error creating report' });
    }
  }
);

export default router;
