// ═══════════════════════════════════════════════════════════════
// migrate-ambiguity.js — Populate ambiguityCondition on existing images
//
// Usage:
//   node migrate-ambiguity.js --dry-run   ← preview changes without writing
//   node migrate-ambiguity.js             ← apply changes
//
// HOW IT WORKS:
//   1. First tries to detect condition from the filename pattern
//   2. Falls back to the FOLDER_CONDITION_MAP if defined
//   3. Shows a summary of what was (or would be) updated
//
// CONFIGURE: Edit the mappings below to match YOUR dataset structure.
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
const mongoose = require("mongoose");
const { Image } = require("./models");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/hacm_annotation";

// ── CONFIGURATION ────────────────────────────────────────────
// Option A: Map FOLDER names to ambiguity conditions
// If ALL images in a folder share the same condition, use this.
// Example: { "CA_Blur": "Blur", "CA_Occ": "Occlusion" }
const FOLDER_CONDITION_MAP = {
  // "FolderName": "Condition",
  // Uncomment and edit these based on your actual folder names:
  // "CA": "Blur",
  // "PH": "Occlusion",
  // "PN": "Low Illumination",
  // "WL": "Background Clutter",
  // "WT": "Blur",
};

// Option B: Detect condition from FILENAME patterns (case-insensitive)
// If the filename contains a keyword, assign that condition.
// These are checked in order — first match wins.
const FILENAME_PATTERNS = [
  { pattern: /blur/i,         condition: "Blur" },
  { pattern: /occ(lusion)?/i, condition: "Occlusion" },
  { pattern: /low[_\s-]?il/i, condition: "Low Illumination" },
  { pattern: /dark/i,         condition: "Low Illumination" },
  { pattern: /clutter/i,      condition: "Background Clutter" },
  { pattern: /bg[_\s-]?cl/i,  condition: "Background Clutter" },
];

// Option C: Map specific filenames to conditions (exact match)
// Use for edge cases that don't fit patterns.
const FILENAME_EXACT_MAP = {
  // "IMG_001.jpg": "Blur",
};
// ─────────────────────────────────────────────────────────────

const VALID_CONDITIONS = ["Blur", "Occlusion", "Low Illumination", "Background Clutter"];

function detectCondition(image) {
  // 1. Exact filename match
  if (FILENAME_EXACT_MAP[image.filename]) {
    return FILENAME_EXACT_MAP[image.filename];
  }

  // 2. Filename pattern match
  for (const { pattern, condition } of FILENAME_PATTERNS) {
    if (pattern.test(image.filename)) {
      return condition;
    }
  }

  // 3. Folder-level mapping
  if (FOLDER_CONDITION_MAP[image.folder]) {
    return FOLDER_CONDITION_MAP[image.folder];
  }

  return null; // Could not determine
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB connected\n");

  // Show current state
  const total = await Image.countDocuments();
  const withCondition = await Image.countDocuments({ ambiguityCondition: { $ne: null } });
  const withoutCondition = await Image.countDocuments({
    $or: [{ ambiguityCondition: null }, { ambiguityCondition: { $exists: false } }],
  });

  console.log("═══════════════════════════════════════════");
  console.log("  CURRENT STATE");
  console.log("═══════════════════════════════════════════");
  console.log(`  Total images:              ${total}`);
  console.log(`  With ambiguityCondition:   ${withCondition}`);
  console.log(`  Missing ambiguityCondition: ${withoutCondition}`);
  console.log("");

  // Show folder breakdown
  const folders = await Image.distinct("folder");
  console.log("  Folders in database:");
  for (const folder of folders.sort()) {
    const count = await Image.countDocuments({ folder });
    const hasCond = await Image.countDocuments({ folder, ambiguityCondition: { $ne: null } });
    const mapped = FOLDER_CONDITION_MAP[folder] || "—";
    console.log(`    ${folder.padEnd(20)} ${count} images  (${hasCond} with condition)  → map: ${mapped}`);
  }
  console.log("");

  // Show sample filenames per folder (to help configure patterns)
  console.log("  Sample filenames per folder:");
  for (const folder of folders.sort()) {
    const samples = await Image.find({ folder }).select("filename -_id").limit(3).lean();
    const names = samples.map((s) => s.filename).join(", ");
    console.log(`    ${folder}: ${names}`);
  }
  console.log("");

  if (withoutCondition === 0) {
    console.log("✅ All images already have ambiguityCondition set. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Process images missing the condition
  const images = await Image.find({
    $or: [{ ambiguityCondition: null }, { ambiguityCondition: { $exists: false } }],
  }).lean();

  const results = { updated: 0, skipped: 0, byCondition: {} };

  for (const img of images) {
    const condition = detectCondition(img);

    if (!condition) {
      results.skipped++;
      continue;
    }

    if (!VALID_CONDITIONS.includes(condition)) {
      console.warn(`  ⚠️ Invalid condition "${condition}" for ${img.filename} — skipping`);
      results.skipped++;
      continue;
    }

    if (!isDryRun) {
      await Image.updateOne({ _id: img._id }, { $set: { ambiguityCondition: condition } });
    }

    results.updated++;
    results.byCondition[condition] = (results.byCondition[condition] || 0) + 1;
  }

  console.log("═══════════════════════════════════════════");
  console.log(isDryRun ? "  DRY RUN RESULTS (no changes written)" : "  MIGRATION RESULTS");
  console.log("═══════════════════════════════════════════");
  console.log(`  Updated:  ${results.updated}`);
  console.log(`  Skipped:  ${results.skipped} (could not determine condition)`);
  console.log("");
  console.log("  By condition:");
  for (const [cond, count] of Object.entries(results.byCondition).sort()) {
    console.log(`    ${cond.padEnd(22)} ${count}`);
  }

  if (isDryRun && results.updated > 0) {
    console.log("\n  ℹ️  Run without --dry-run to apply these changes:");
    console.log("     node migrate-ambiguity.js");
  }

  if (results.skipped > 0) {
    console.log("\n  ⚠️  Some images couldn't be mapped. Options:");
    console.log("     1. Edit FOLDER_CONDITION_MAP in this script");
    console.log("     2. Edit FILENAME_PATTERNS for pattern-based matching");
    console.log("     3. Edit FILENAME_EXACT_MAP for specific files");
  }

  await mongoose.disconnect();
  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
