import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { body, param, query, validationResult } from 'express-validator';
import Report  from '../models/Report.js';
import Comment from '../models/Comment.js';
import Upvote  from '../models/Upvote.js';
import User    from '../models/User.js';
import sendEmail                from '../utils/sendEmail.js';
import auth                     from '../middleware/authMiddleware.js';
import asyncHandler             from '../middleware/asyncHandler.js';
import axios                    from 'axios';
import redisClient              from '../utils/redisClient.js';
import { invalidateUserReportCache } from '../utils/cacheUtils.js';

// --- Multer setup with fileFilter ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only images allowed'));
    }
    cb(null, true);
  }
});

const router = express.Router();

// Helper: delete uploaded files on error
async function cleanupFiles(files=[]) {
  await Promise.all(files.map(f => fs.unlink(path.join('uploads', f.filename)).catch(()=>{})));
}

// Helper: check validationResult
function validate(req, res, next) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    return res.status(400).json({ errors: errs.array() });
  }
  next();
}

// POST /api/reports
router.post('/',
  auth,
  upload.array('images', 5),
  [
    body('issueType').isString().notEmpty(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('description').isString().isLength({ min: 5, max: 500 }),
    body('address').optional().isString().trim().isLength({ max: 255 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    try {
      const { issueType, latitude, longitude, description, address } = req.body;
      const imageUrls = req.files.map(f => `/uploads/${f.filename}`);

      const report = await Report.create({
        user: req.user.id,
        issueType,
        location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
        address,
        description,
        imageUrls
      });

      // Notify user by email (fire-and-forget)
      const userInfo = await User.findById(req.user.id).select('name email');
      if (userInfo) {
        const html = `
          <h2>Thanks for your report!</h2>
          <p>Hi ${userInfo.name},</p>
          <p>We received your <strong>${issueType}</strong> report:</p>
          <ul>
            <li>${description}</li>
            <li>Location: ${address || `${latitude}, ${longitude}`}</li>
          </ul>
        `;
        sendEmail({ to: userInfo.email, subject: 'Report received', html })
          .catch(console.error);
      }

      await invalidateUserReportCache(req.user.id);
      res.status(201).json({ report, msg: 'Report created; confirmation email sent.' });
    } catch (err) {
      // if multer error
      if (err instanceof multer.MulterError) {
        await cleanupFiles(req.files);
        return res.status(400).json({ msg: err.message });
      }
      console.error(err);
      await cleanupFiles(req.files);
      res.status(500).json({ msg: 'Server error creating report' });
    }
  })
);

// GET /api/reports
router.get('/',
  auth,
  [
    query('status').optional().isIn(['all','Pending','In Progress','Fixed','Rejected']),
    query('type').optional().isIn(['all','Pothole','Streetlight','Graffiti','Other'])
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { status='all', type='all' } = req.query;
    const cacheKey = `reports:${status}:${type}:user:${req.user.id}`;
    const cached  = await redisClient.get(cacheKey);
    if (cached) {
      console.log('serving from cache');
      return res.json(JSON.parse(cached));
    }

    const filter = {};
    if (status!=='all') filter.status = status;
    if (type!=='all')   filter.issueType = type;

    const reports = await Report.find(filter)
      .populate('user','name email')
      .sort({ createdAt: -1 })
      .lean();

    const ids = reports.map(r=>r._id);
    const [ ups, cms, myUps ] = await Promise.all([
      Upvote.aggregate([
        { $match:{ report:{ $in: ids } } },
        { $group:{ _id:'$report', count:{ $sum:1 } } }
      ]),
      Comment.aggregate([
        { $match:{ report:{ $in: ids } } },
        { $group:{ _id:'$report', count:{ $sum:1 } } }
      ]),
      Upvote.find({ user:req.user.id, report:{ $in: ids } }).select('report')
    ]);

    const upMap = Object.fromEntries(ups.map(u=>[u._id.toString(), u.count]));
    const cmMap = Object.fromEntries(cms.map(c=>[c._id.toString(), c.count]));
    const upSet = new Set(myUps.map(u=>u.report.toString()));

    const enriched = reports.map(r => ({
      ...r,
      upvoteCount:   upMap[r._id.toString()]   || 0,
      commentCount:  cmMap[r._id.toString()]   || 0,
      hasUpvoted:    upSet.has(r._id.toString())
    }));

    await redisClient.setEx(cacheKey, 300, JSON.stringify(enriched));
    res.json(enriched);
  })
);

// GET /api/reports/heatmap
router.get('/heatmap',
  auth,
  asyncHandler(async (req, res) => {
    try {
      const points = (await Report.find().select('location.coordinates'))
        .map(r => ({
          latitude:  r.location.coordinates[1],
          longitude: r.location.coordinates[0]
        }));
      const { data: geojson } = await axios.post(
        'http://localhost:5001/predict_hotspots',
        { reports: points },
        { timeout: 5000 }
      );
      return res.json(geojson);
    } catch (err) {
      console.error('heatmap error', err);
      return res.status(502).json({ msg: 'Heatmap service unavailable' });
    }
  })
);

// POST /api/reports/:id/upvote
router.post('/:id/upvote',
  auth,
  param('id').isMongoId(),
  validate,
  asyncHandler(async (req, res) => {
    const { id: reportId } = req.params;
    const userId = req.user.id;

    const existing = await Upvote.findOne({ user:userId, report:reportId });
    if (existing) {
      await existing.deleteOne();
    } else {
      await Upvote.create({ user:userId, report:reportId });
    }
    const count = await Upvote.countDocuments({ report:reportId });
    await invalidateUserReportCache(userId);

    res.json({ upvotes: count, upvoted: !existing });
  })
);

// POST /api/reports/:id/comments
router.post('/:id/comments',
  auth,
  param('id').isMongoId(),
  body('text').isString().isLength({ min:1, max:300 }),
  validate,
  asyncHandler(async (req, res) => {
    const comment = await Comment.create({
      user:   req.user.id,
      report: req.params.id,
      text:   req.body.text
    });
    await comment.populate('user','name');
    await invalidateUserReportCache(req.user.id);
    res.status(201).json(comment);
  })
);

// PUT /api/reports/:id
router.put('/:id',
  auth,
  upload.array('images',5),
  [
    param('id').isMongoId(),
    body('issueType').isString(),
    body('latitude').isFloat({ min:-90,max:90 }),
    body('longitude').isFloat({ min:-180,max:180 }),
    body('description').isString().isLength({ min:5, max:500 }),
    body('address').optional().isString().isLength({ max:255 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const rpt = await Report.findById(req.params.id);
    if (!rpt) return res.status(404).json({ msg:'Not found' });
    if (rpt.user.toString()!==req.user.id) return res.status(403).json({ msg:'Unauthorized' });

    const { issueType, latitude, longitude, description, address } = req.body;
    rpt.issueType = issueType;
    rpt.location  = {
      type: 'Point',
      coordinates: [parseFloat(longitude),parseFloat(latitude)]
    };
    rpt.description = description;
    rpt.address     = address;
    if (req.files.length) {
      rpt.imageUrls = req.files.map(f=>`/uploads/${f.filename}`);
    }
    await rpt.save();
    await invalidateUserReportCache(req.user.id);

    // Send update email (async)
    User.findById(req.user.id).select('name email').then(u=>{
      if (u) {
        sendEmail({
          to: u.email,
          subject: 'Your report was updated',
          html: `<p>Hi ${u.name}, your report has been updated.</p>`
        }).catch(console.error);
      }
    });
    res.json({ report: rpt, msg:'Updated & emailed' });
  })
);

// DELETE /api/reports/:id
router.delete('/:id',
  auth,
  param('id').isMongoId(),
  validate,
  asyncHandler(async (req, res) => {
    const rpt = await Report.findById(req.params.id);
    if (!rpt) return res.status(404).json({ msg:'Not found' });
    if (rpt.user.toString()!==req.user.id) return res.status(403).json({ msg:'Unauthorized' });
    if (rpt.status !== 'Pending') return res.status(400).json({ msg:'Only pending can be deleted' });

    await rpt.deleteOne();
    await invalidateUserReportCache(req.user.id);

    // Send deletion email
    User.findById(req.user.id).select('name email').then(u=>{
      if (u) {
        sendEmail({
          to: u.email,
          subject: 'Your report was deleted',
          html: `<p>Hi ${u.name}, your report has been deleted.</p>`
        }).catch(console.error);
      }
    });
    res.json({ msg:'Deleted & emailed' });
  })
);

// GET single report
router.get('/:id',
  auth,
  param('id').isMongoId(),
  validate,
  asyncHandler(async (req, res) => {
    const rpt = await Report.findById(req.params.id);
    if (!rpt) return res.status(404).json({ msg:'Not found' });
    if (rpt.user.toString()!==req.user.id) return res.status(403).json({ msg:'Unauthorized' });
    res.json(rpt);
  })
);

// GET /api/reports/:id/comments
router.get('/:id/comments',
  auth,
  param('id').isMongoId(),
  validate,
  asyncHandler(async (req, res) => {
    const cms = await Comment.find({ report:req.params.id })
      .sort({ createdAt:-1 })
      .populate('user','name');
    res.json(cms);
  })
);

export default router;
