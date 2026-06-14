// ═══════════════════════════════════════════════════════════════
// seedDrive.js — Fetch images from Google Drive and seed MongoDB
//
// Usage:
//   node seedDrive.js                  ← uses GOOGLE_DRIVE_FOLDER_ID from .env
//   node seedDrive.js <folderId>       ← override folder ID
//
// This will:
//   1. List all subfolders in the Drive folder (CA, PH, PN, WL, WT)
//   2. For each subfolder, list all image files
//   3. Insert each image into MongoDB with a proxy URL
//   4. Skip images that already exist (safe to re-run)
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
const mongoose = require("mongoose");
const { Image } = require("./models");
const { listSubfolders, listImages } = require("./driveService");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/hacm_annotation";

async function main() {
  const rootFolderId = process.argv[2] || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) {
    console.error("❌ No folder ID provided.");
    console.error(
      "   Set GOOGLE_DRIVE_FOLDER_ID in .env or pass it as argument:",
    );
    console.error("   node seedDrive.js <folderId>");
    process.exit(1);
  }

  if (!process.env.GOOGLE_API_KEY) {
    console.error("❌ GOOGLE_API_KEY is not set in .env");
    console.error(
      "   Get one from: https://console.cloud.google.com/apis/credentials",
    );
    console.error("   Enable 'Google Drive API' in your Google Cloud project.");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB connected");

  // Clean existing images to prevent duplicates from multiple runs
  const existingCount = await Image.countDocuments();
  if (existingCount > 0) {
    console.log(
      `\n🗑️  Clearing ${existingCount} existing images from database...`,
    );
    await Image.deleteMany({});
    console.log("   Done — database is clean.");
  }

  // Step 1: List subfolders
  console.log(`\n📁 Listing subfolders in Drive folder: ${rootFolderId}`);
  const subfolders = await listSubfolders(rootFolderId);

  if (subfolders.length === 0) {
    console.log(
      "⚠️  No subfolders found. Treating root folder as a single image folder...",
    );
    await seedFolder(rootFolderId, "default");
  } else {
    console.log(
      `   Found ${subfolders.length} subfolders: ${subfolders.map((f) => f.name).join(", ")}`,
    );

    // Step 2: Process each subfolder
    for (const folder of subfolders) {
      await seedFolder(folder.id, folder.name);
    }
  }

  // Final summary
  const totalImages = await Image.countDocuments();
  console.log(`\n════════════════════════════════════════`);
  console.log(`✅ Done! Total images in database: ${totalImages}`);
  console.log(`════════════════════════════════════════`);

  await mongoose.disconnect();
}

async function seedFolder(folderId, folderName) {
  console.log(`\n📂 Processing folder: ${folderName}`);

  const images = await listImages(folderId);
  console.log(`   Found ${images.length} images`);

  let inserted = 0,
    skipped = 0;

  for (const img of images) {
    // Check if already exists
    const exists = await Image.findOne({
      filename: img.name,
      folder: folderName,
    });
    if (exists) {
      skipped++;
      continue;
    }

    await Image.create({
      filename: img.name,
      folder: folderName,
      driveFileId: img.id,
      url: `https://lh3.googleusercontent.com/d/${img.id}`,
      annotationCount: 0,
      isComplete: false,
    });
    inserted++;
  }

  console.log(`   ✅ Inserted: ${inserted}, Skipped (duplicates): ${skipped}`);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
