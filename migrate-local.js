require('dotenv').config();
const mongoose = require('mongoose');
const { Image } = require('./models');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected to DB');
  const images = await Image.find({ url: { $regex: '^/api/drive-image/' } });
  console.log(`Found ${images.length} images to migrate.`);
  
  let updated = 0;
  for (const img of images) {
    const match = img.url.match(/\/api\/drive-image\/(.+)/);
    if (match) {
      img.url = 'https://lh3.googleusercontent.com/d/' + match[1];
      await img.save();
      updated++;
    }
  }
  console.log('Migrated: ' + updated);
  process.exit(0);
}).catch(console.error);
