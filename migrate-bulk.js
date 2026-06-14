require('dotenv').config();
const mongoose = require('mongoose');
const { Image } = require('./models');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected to DB for bulk migrate');
  const images = await Image.find({ url: { $regex: '^/api/drive-image/' } });
  console.log(`Found ${images.length} images to migrate.`);
  
  const bulkOps = [];
  for (const img of images) {
    const match = img.url.match(/\/api\/drive-image\/(.+)/);
    if (match) {
      bulkOps.push({
        updateOne: {
          filter: { _id: img._id },
          update: { url: 'https://lh3.googleusercontent.com/d/' + match[1] }
        }
      });
    }
  }
  
  if (bulkOps.length > 0) {
    console.log(`Executing ${bulkOps.length} bulk operations...`);
    const result = await Image.bulkWrite(bulkOps);
    console.log(`Bulk update complete. Modified: ${result.modifiedCount}`);
  } else {
    console.log('No operations to perform.');
  }
  process.exit(0);
}).catch(console.error);
