require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { Image, Annotation, Annotator } = require("./models");

// Google Drive image proxy (only loaded if API key is configured)
let driveService = null;
try {
  if (process.env.GOOGLE_API_KEY) {
    driveService = require("./driveService");
    console.log("📁 Google Drive service loaded");
  }
} catch (e) {
  console.warn("⚠️  driveService not available:", e.message);
}

// Compression middleware — reduces JSON & image transfer sizes significantly
let compression;
try {
  compression = require("compression");
} catch (e) {
  console.warn("⚠️  compression module not available, install with: npm install compression");
}

const app = express();
app.use(cors());
app.use(express.json());

// Enable gzip/brotli compression for all responses
if (compression) {
  app.use(compression());
}

app.get("/", (req, res) => {
  res.send("HACM API is running on Vercel!");
});

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/hacm_annotation";
const MAX_ANNOTATORS = parseInt(process.env.MAX_ANNOTATORS || "5", 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "30", 10);
const PORT = process.env.PORT || 4000;

let isConnected = 0;
const connectDB = async () => {
  if (isConnected || mongoose.connection.readyState === 1) {
    isConnected = 1;
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = 1;
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    throw error;
  }
};

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Database connection failed. Ensure MongoDB Atlas IP Whitelist includes 0.0.0.0/0" });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/register  { name }
// Returns existing annotator if name already used, else creates new.
// ═══════════════════════════════════════════════════════════════
app.post("/api/register", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    if (name.length < 2)
      return res
        .status(400)
        .json({ success: false, error: "Name is required" });

    let annotator = await Annotator.findOne({
      name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    });
    if (annotator) {
      return res.json({
        success: true,
        annotatorId: annotator.annotatorId,
        name: annotator.name,
        isNew: false,
      });
    }

    const count = await Annotator.countDocuments();
    const annotatorId = "ANNO_" + String(count + 1).padStart(3, "0");
    annotator = await Annotator.create({ annotatorId, name });

    res.json({ success: true, annotatorId, name, isNew: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/session?annotatorId=ANNO_001
// Returns a batch of images that:
//   - are NOT yet complete (annotationCount < MAX_ANNOTATORS)
//   - this annotator has NOT already annotated
//
// OPTIMIZED: Uses only imageId projection for done-lookup,
//            limits batch to BATCH_SIZE (default 30)
// ═══════════════════════════════════════════════════════════════
app.get("/api/session", async (req, res) => {
  try {
    const { annotatorId } = req.query;
    if (!annotatorId)
      return res
        .status(400)
        .json({ success: false, error: "annotatorId required" });

    const totalImages = await Image.countDocuments();
    if (totalImages === 0)
      return res.json({ success: false, error: "IMAGE_CACHE_EMPTY" });

    // Image IDs this annotator already labeled — only fetch _id field
    const done = await Annotation.find({ annotatorId })
      .select("imageId -_id")
      .lean();
    const doneIds = done.map((d) => d.imageId);

    // Find images: not complete, not already done by this person
    const images = await Image.aggregate([
      { $match: { isComplete: false, _id: { $nin: doneIds } } },
      { $sample: { size: BATCH_SIZE } }, // random order
      // Only project the fields we need — reduce response size
      { $project: { filename: 1, folder: 1, url: 1 } },
    ]);

    const remainingCount = await Image.countDocuments({
      isComplete: false,
      _id: { $nin: doneIds },
    });
    const fullyDone = await Image.countDocuments({ isComplete: true });

    res.json({
      success: true,
      images: images.map((img) => ({
        id: img._id.toString(),
        folder: img.folder,
        filename: img.filename,
        url: img.url,
      })),
      totalImages,
      doneCount: doneIds.length,
      remaining: remainingCount,
      fullyDone,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/annotate
// Body: { annotatorId, annotatorName, imageId, label, labelName, confidence }
//
// - Saves the annotation (unique per imageId+annotatorId)
// - Atomically increments Image.annotationCount
// - If annotationCount reaches MAX_ANNOTATORS -> sets isComplete=true,
//   which removes it from future /api/session results.
// ═══════════════════════════════════════════════════════════════
app.post("/api/annotate", async (req, res) => {
  try {
    const {
      annotatorId,
      annotatorName,
      imageId,
      label,
      labelName,
      confidence,
    } = req.body;
    if (!annotatorId || !imageId || !label) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // Create annotation (unique index prevents duplicate per annotator+image)
    try {
      await Annotation.create({
        imageId,
        annotatorId,
        annotatorName,
        label,
        labelName,
        confidence: Math.max(0, Math.min(100, parseInt(confidence, 10) || 0)),
      });
    } catch (err) {
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ success: false, error: "You already annotated this image" });
      }
      throw err;
    }

    // Atomically bump the counter and check completion
    const updated = await Image.findByIdAndUpdate(
      imageId,
      { $inc: { annotationCount: 1 } },
      { new: true },
    );

    if (
      updated &&
      updated.annotationCount >= MAX_ANNOTATORS &&
      !updated.isComplete
    ) {
      updated.isComplete = true;
      await updated.save();
    }

    // Update annotator's total
    await Annotator.findOneAndUpdate(
      { annotatorId },
      { $inc: { totalDone: 1 } },
    );

    res.json({
      success: true,
      imageComplete: updated ? updated.isComplete : false,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/progress?annotatorId=ANNO_001
// ═══════════════════════════════════════════════════════════════
app.get("/api/progress", async (req, res) => {
  try {
    const { annotatorId } = req.query;
    if (!annotatorId)
      return res
        .status(400)
        .json({ success: false, error: "annotatorId required" });

    const mine = await Annotation.find({ annotatorId }).lean();
    const submitted = mine.length;
    const avgConf = submitted
      ? Math.round(mine.reduce((s, a) => s + a.confidence, 0) / submitted)
      : 0;

    const byFolder = {};
    mine.forEach((a) => {
      byFolder[a.label] = (byFolder[a.label] || 0) + 1;
    });

    const total = await Image.countDocuments();
    const fullyDone = await Image.countDocuments({ isComplete: true });
    const done = mine.map((a) => a.imageId);
    const remaining = await Image.countDocuments({
      isComplete: false,
      _id: { $nin: done },
    });

    res.json({
      success: true,
      submitted,
      avgConf,
      total,
      fullyDone,
      remaining,
      byFolder,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/export  — dump all annotations as JSON (for researchers)
// ═══════════════════════════════════════════════════════════════
app.get("/api/export", async (req, res) => {
  try {
    const annotations = await Annotation.find()
      .populate("imageId", "filename folder url")
      .lean();
    const out = annotations.map((a) => ({
      annotation_id: a._id.toString(),
      image_id: a.imageId?._id?.toString(),
      filename: a.imageId?.filename,
      folder: a.imageId?.folder,
      annotator_id: a.annotatorId,
      annotator_name: a.annotatorName,
      label: a.label,
      label_name: a.labelName,
      confidence: a.confidence,
      timestamp: a.createdAt,
    }));
    res.json({ success: true, count: out.length, annotations: out });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/drive-image/:fileId — proxy images from Google Drive
// This avoids CORS issues and provides reliable image loading.
//
// OPTIMIZED: Larger cache (200 items), longer TTL (1 hour),
//            aggressive browser caching (7 days), streaming first
//            bytes immediately while caching in background.
// ═══════════════════════════════════════════════════════════════
const imageCache = new Map(); // fileId → { buffer, contentType, cachedAt }
const CACHE_MAX = 200; // increased from 50 — images are typically 50-200KB each
const CACHE_TTL = 60 * 60 * 1000; // 1 hour (up from 5 minutes)

app.get("/api/drive-image/:fileId", async (req, res) => {
  try {
    if (!driveService) {
      return res.status(503).json({ error: "Google Drive not configured" });
    }

    const { fileId } = req.params;

    // Check cache first
    const cached = imageCache.get(fileId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      res.set("Content-Type", cached.contentType);
      res.set("Content-Length", cached.buffer.length);
      res.set("Cache-Control", "public, max-age=604800, immutable"); // browser cache 7 days
      res.set("X-Cache", "HIT");
      return res.send(cached.buffer);
    }

    // Fetch from Drive
    const stream = await driveService.getFileStream(fileId);

    // Set headers immediately so the browser starts receiving data fast
    const contentType = stream.headers?.["content-type"] || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("X-Cache", "MISS");

    // Collect chunks for caching while simultaneously streaming to response
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });
    stream.on("end", () => {
      const buffer = Buffer.concat(chunks);

      // Store in cache (evict oldest if full)
      if (imageCache.size >= CACHE_MAX) {
        const oldest = imageCache.keys().next().value;
        imageCache.delete(oldest);
      }
      imageCache.set(fileId, { buffer, contentType, cachedAt: Date.now() });

      res.set("Content-Length", buffer.length);
      res.send(buffer);
    });
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(404).json({ error: "Image not found" });
      } else {
        res.end();
      }
    });
  } catch (e) {
    console.error("Drive image proxy error:", e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch image from Drive" });
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/file/:id — serve images stored in GridFS (used when
// seed.js --local was used to upload images directly into Mongo)
// ═══════════════════════════════════════════════════════════════
app.get("/api/file/:id", async (req, res) => {
  try {
    const { GridFSBucket, ObjectId } = require("mongodb");
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: "images",
    });
    const _id = new ObjectId(req.params.id);
    const stream = bucket.openDownloadStream(_id);
    stream.on("error", () => res.status(404).end());
    stream.pipe(res);
  } catch (e) {
    res.status(404).end();
  }
});

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`🚀 HACM API running on port ${PORT}`));
}

module.exports = app;
