// ═══════════════════════════════════════════════════════════════
// driveService.js — Google Drive API v3 wrapper
//
// Lists subfolders and image files from a public Drive folder.
// Requires a GOOGLE_API_KEY (free, no OAuth needed for public folders).
// ═══════════════════════════════════════════════════════════════
const { google } = require("googleapis");

let _drive = null;

/**
 * Get or create a Google Drive API client.
 * Uses API key auth (works for publicly shared folders).
 */
function getDrive() {
  if (_drive) return _drive;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set in .env");
  _drive = google.drive({ version: "v3", auth: apiKey });
  return _drive;
}

/**
 * List all items in a Drive folder, handling pagination.
 * @param {string} folderId - The Google Drive folder ID
 * @param {string} query    - Additional query filter (e.g. mimeType)
 * @param {string} fields   - Fields to return per file
 * @returns {Array} All files/folders in the folder
 */
async function listAll(folderId, query = "", fields = "id, name, mimeType") {
  const drive = getDrive();
  const q = `'${folderId}' in parents and trashed = false${query ? " and " + query : ""}`;
  const allFiles = [];
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken: pageToken || undefined,
      orderBy: "name"
    });
    allFiles.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

/**
 * List subfolders inside a Drive folder.
 * @param {string} parentFolderId
 * @returns {Array<{id: string, name: string}>}
 */
async function listSubfolders(parentFolderId) {
  return listAll(
    parentFolderId,
    "mimeType = 'application/vnd.google-apps.folder'",
    "id, name"
  );
}

/**
 * List all image files inside a Drive folder.
 * @param {string} folderId
 * @returns {Array<{id: string, name: string, mimeType: string}>}
 */
async function listImages(folderId) {
  return listAll(
    folderId,
    "mimeType contains 'image/'",
    "id, name, mimeType"
  );
}

/**
 * Get a readable stream for a Drive file (used for proxying).
 * @param {string} fileId
 * @returns {ReadableStream}
 */
async function getFileStream(fileId) {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return res.data;
}

/**
 * Get file metadata (name, mimeType, size).
 * @param {string} fileId
 */
async function getFileMeta(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size"
  });
  return res.data;
}

module.exports = { listSubfolders, listImages, getFileStream, getFileMeta };
