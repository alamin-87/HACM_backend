# HACM Annotation Backend

This is the Node.js / Express backend for the HACM Image Annotation tool.

## Features
- Provides REST APIs to serve images for annotation.
- Stores annotations directly into MongoDB.
- Protects against duplicate annotations (one person annotates a maximum of one time per image).
- Hides images once they reach 5 annotations.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file based on `.env.example` and add your MongoDB connection URI.

3. Start the server:
   ```bash
   npm start
   ```

## Scripts
- `npm start`: Runs the server.
- `npm run seed`: Imports images into MongoDB.
- `npm run seed:drive`: Imports images from Google Drive.
