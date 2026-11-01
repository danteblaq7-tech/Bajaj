const router = require('express').Router();
const express = require('express');
const storage = require('../services/storage');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { requireAuth } = require('../middleware/auth');

// POST /api/uploads  with the image bytes as the body and Content-Type image/jpeg | image/png | image/webp.
// Returns { url: "/uploads/<name>" }. Send that url in checklist, selfie, pickup and delivery photo fields.
router.post('/', requireAuth, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }), wrap(async (req, res) => {
  const b = req.body;
  if (!Buffer.isBuffer(b) || !b.length) throw E.badRequest('Send the image as the request body with Content-Type image/jpeg, image/png or image/webp');
  if (b.length > storage.MAX_BYTES) throw E.badRequest('Image is larger than 5 MB');
  res.status(201).json(await storage.save(b));
}));
module.exports = router;
