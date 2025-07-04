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

// GET /api/reports
// List or filter reports (including reporter name/email)
router.get('/', auth, async (req, res) => {
  try {
    const { status = 'all', type = 'all' } = req.query;
    const filter = {};
    if (status !== 'all')    filter.status    = status;
    if (type   !== 'all')    filter.issueType = type;

    // Populate user (name & email), then lean()
    const reports = await Report.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const ids = reports.map(r => r._id);
    const [ ups, cms ] = await Promise.all([
      Upvote.aggregate([
        { $match: { report: { $in: ids } } },
        { $group: { _id: '$report', count: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { report: { $in: ids } } },
        { $group: { _id: '$report', count: { $sum: 1 } } }
      ])
    ]);

    const upMap = ups.reduce((m,u) => {
      m[u._id.toString()] = u.count;
      return m;
    }, {});
    const cMap = cms.reduce((m,c) => {
      m[c._id.toString()] = c.count;
      return m;
    }, {});

    // Enrich each report with upvoteCount, commentCount, plus user.name & user.email
    const enriched = reports.map(r => ({
      _id:         r._id,
      issueType:   r.issueType,
      description: r.description,
      location:    r.location,
      address:     r.address,
      status:      r.status,
      rejectReason:r.rejectReason,
      createdAt:   r.createdAt,
      updatedAt:   r.updatedAt,
      imageUrls:   r.imageUrls,
      user: {
        _id:   r.user._id,
        name:  r.user.name,
        email: r.user.email
      },
      upvoteCount:  upMap[r._id.toString()]  || 0,
      commentCount: cMap[r._id.toString()]   || 0
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error listing reports' });
  }
});

// GET /api/reports/:id
// Fetch single report (for editing or detail view)
router.get('/:id', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ msg: 'Report not found' });
    if (report.user.toString() !== req.user.id)
      return res.status(403).json({ msg: 'Unauthorized' });

    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error fetching report' });
  }
});

// PUT /api/reports/:id
// Update an existing report (only if Pending)
router.put(
  '/:id',
  auth,
  upload.array('images', 5),
  async (req, res) => {
    try {
      const report = await Report.findById(req.params.id);
      if (!report) return res.status(404).json({ msg: 'Report not found' });
      // only the creator can edit
      if (report.user.toString() !== req.user.id)
        return res.status(403).json({ msg: 'Unauthorized' });
      // only pending reports are editable
      if (report.status !== 'Pending')
        return res.status(400).json({ msg: 'Only pending reports can be edited' });

      const { issueType, latitude, longitude, description, address } = req.body;
      if (issueType)  report.issueType = issueType;
      if (description) report.description = description;
      if (address)     report.address     = address;  // ← new
      if (latitude && longitude) {
        report.location.coordinates = [
          parseFloat(longitude),
          parseFloat(latitude)
        ];
      }
      if (req.files?.length) {
        report.imageUrls = req.files.map(f => `/uploads/${f.filename}`);
      }

      await report.save();
      res.json(report);
    } catch (err) {
      console.error(err);
      res.status(500).json({ msg: 'Server error updating report' });
    }
  }
);

// DELETE /api/reports/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ msg: 'Report not found' });
    // only the creator can delete
    if (report.user.toString() !== req.user.id)
      return res.status(403).json({ msg: 'Unauthorized' });
    // only pending reports are deletable
    if (report.status !== 'Pending')
      return res.status(400).json({ msg: 'Only pending reports can be deleted' });

    await report.deleteOne();
    res.json({ msg: 'Report deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error deleting report' });
  }
});

export default router;
