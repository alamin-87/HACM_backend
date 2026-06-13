// ═══════════════════════════════════════════════════════════════
// seed.js — Import images into MongoDB
//
// Two ways to provide image URLs:
//
// 1) From a JSON file (recommended if images are already hosted
//    somewhere — e.g. a public Drive/S3/CDN folder):
//    node seed.js images.json
//
//    images.json format:
//    [
//      { "filename": "WT_0001.jpg", "folder": "WT", "url": "https://..." },
//      ...
//    ]
//
// 2) From a local folder of image files — uploads each file to
//    MongoDB GridFS and stores a /api/file/:id URL.
//    node seed.js --local ./images/WT WT
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { Image } = require("./models");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/hacm_annotation";

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const args = process.argv.slice(2);

  if (args[0] === "--local") {
    await seedFromLocalFolder(args[1], args[2] || "WT");
  } else if (args[0]) {
    await seedFromJson(args[0]);
  } else {
    console.log("Usage:");
    console.log("  node seed.js images.json");
    console.log("  node seed.js --local ./images/WT WT");
    process.exit(1);
  }

  await mongoose.disconnect();
}

async function seedFromJson(jsonPath) {
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const items = JSON.parse(raw);

  let inserted = 0, skipped = 0;
  for (const item of items) {
    const exists = await Image.findOne({ filename: item.filename, folder: item.folder });
    if (exists) { skipped++; continue; }
    await Image.create({
      filename: item.filename,
      folder: item.folder,
      url: item.url,
      annotationCount: 0,
      isComplete: false
    });
    inserted++;
  }
  console.log(`✅ Inserted ${inserted} images, skipped ${skipped} duplicates.`);
}

// Uses GridFS to store images directly in MongoDB.
// Served back via GET /api/file/:id (add this route to server.js if used).
async function seedFromLocalFolder(folderPath, folderName) {
  const { GridFSBucket } = require("mongodb");
  const db = mongoose.connection.db;
  const bucket = new GridFSBucket(db, { bucketName: "images" });

  const files = fs.readdirSync(folderPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  let inserted = 0;

  for (const filename of files) {
    const exists = await Image.findOne({ filename, folder: folderName });
    if (exists) continue;

    const filePath = path.join(folderPath, filename);
    const fileId = await new Promise((resolve, reject) => {
      const uploadStream = bucket.openUploadStream(filename);
      fs.createReadStream(filePath)
        .pipe(uploadStream)
        .on("error", reject)
        .on("finish", () => resolve(uploadStream.id));
    });

    await Image.create({
      filename,
      folder: folderName,
      url: `/api/file/${fileId}`,   // relative — server prefixes with its own host
      annotationCount: 0,
      isComplete: false
    });
    inserted++;
  }
  console.log(`✅ Inserted ${inserted} images from ${folderPath} into GridFS.`);
}

main().catch(err => { console.error(err); process.exit(1); });
