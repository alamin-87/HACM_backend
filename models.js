const mongoose = require("mongoose");

// ── Image collection ─────────────────────────────────────────
// One document per image. `annotationCount` is denormalized for
// fast filtering of "still needs annotators" without a join.
const imageSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  folder: { type: String, required: true, index: true }, // e.g. "WT"
  url: { type: String, required: true }, // public URL or base64 / GridFS ref
  driveFileId: { type: String, default: null, index: true }, // Google Drive file ID (if sourced from Drive)
  annotationCount: { type: Number, default: 0, index: true },
  isComplete: { type: Boolean, default: false, index: true }, // true once 5 annotators done

  // ── Research Metadata ──────────────────────────────────────
  // Required for ambiguity-stratified analysis (central empirical contribution)
  ambiguityCondition: {
    type: String,
    enum: ["Blur", "Occlusion", "Low Illumination", "Background Clutter"],
    default: null,
    index: true,
  },
  trueLabel: { type: String, default: null }, // ground-truth label from collector (for accuracy & ECE)
  objectInstanceId: { type: String, default: null }, // e.g. "Pen_01", "Pen_02" — tracks visual variety
  collectorId: { type: String, default: null, index: true }, // who collected this image (e.g. "Al-Amin")

  createdAt: { type: Date, default: Date.now }
});

// ── Annotation collection ────────────────────────────────────
// One document per (image, annotator) pair — the actual JSON label.
const annotationSchema = new mongoose.Schema({
  imageId: { type: mongoose.Schema.Types.ObjectId, ref: "Image", required: true, index: true },
  annotatorId: { type: String, required: true, index: true },
  annotatorName: { type: String, required: true },
  label: { type: String, required: true },       // e.g. "WT"
  labelName: { type: String, required: true },   // e.g. "Watch"
  confidence: { type: Number, required: true, min: 0, max: 100 },

  // ── Quality Control (QC) Fields ────────────────────────────
  durationSeconds: { type: Number, default: null }, // time spent viewing image; discard if < 3s
  sessionId: { type: String, default: null, index: true }, // tracks per-sitting compliance (50–300 images)
  isWarmUp: { type: Boolean, default: false }, // true for initial 5-image warm-up set

  // User-provided ambiguity condition
  ambiguityCondition: {
    type: [String],
    enum: ["Blur", "Occlusion", "Low Illumination", "Background Clutter"],
    default: [],
  },

  createdAt: { type: Date, default: Date.now }
});

// Prevent the same annotator from annotating the same image twice
annotationSchema.index({ imageId: 1, annotatorId: 1 }, { unique: true });

// ── Annotator collection ─────────────────────────────────────
const annotatorSchema = new mongoose.Schema({
  annotatorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, default: null }, // annotator contact email
  totalDone: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Image = mongoose.model("Image", imageSchema);
const Annotation = mongoose.model("Annotation", annotationSchema);
const Annotator = mongoose.model("Annotator", annotatorSchema);

module.exports = { Image, Annotation, Annotator };
