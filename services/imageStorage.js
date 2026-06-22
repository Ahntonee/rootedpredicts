'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

let _client = null;

function getClient() {
  if (!_client) {
    const endpoint  = process.env.STORAGE_ENDPOINT;
    const accessKey = process.env.STORAGE_ACCESS_KEY;
    const secretKey = process.env.STORAGE_SECRET_KEY;
    const region    = process.env.STORAGE_REGION || 'auto';

    if (!endpoint || !accessKey || !secretKey || !process.env.STORAGE_BUCKET) {
      throw new Error(
        'Image storage is not configured. Set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, ' +
        'STORAGE_SECRET_KEY, STORAGE_BUCKET, and STORAGE_PUBLIC_URL in your .env file.'
      );
    }

    _client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      // Cloudflare R2 requires path-style; DO Spaces uses virtual-hosted (false)
      forcePathStyle: process.env.STORAGE_PATH_STYLE === 'true',
    });
  }
  return _client;
}

/**
 * Upload a base64 data URL to object storage and return the public URL.
 * @param {string} dataURL  e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 * @param {string} folder   S3 key prefix, default "blog"
 * @returns {Promise<string>} public URL
 */
async function uploadImage(dataURL, folder = 'blog') {
  const match = dataURL.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if (!match) throw new Error('Invalid image data URL');

  const [, mimeType, b64] = match;
  const ext    = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
  const key    = `${folder}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(b64, 'base64');

  await getClient().send(new PutObjectCommand({
    Bucket:      process.env.STORAGE_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
    ACL:         'public-read', // DO Spaces needs this; Cloudflare R2 ignores it
  }));

  const base = (process.env.STORAGE_PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/${key}`;
}

module.exports = { uploadImage };
