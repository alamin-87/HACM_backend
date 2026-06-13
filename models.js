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
  createdAt: { type: Date, default: Date.now }
});

// Prevent the same annotator from annotating the same image twice
annotationSchema.index({ imageId: 1, annotatorId: 1 }, { unique: true });

// ── Annotator collection ─────────────────────────────────────
const annotatorSchema = new mongoose.Schema({
  annotatorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  totalDone: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Image = mongoose.model("Image", imageSchema);
const Annotation = mongoose.model("Annotation", annotationSchema);
const Annotator = mongoose.model("Annotator", annotatorSchema);

module.exports = { Image, Annotation, Annotator };
