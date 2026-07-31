/* eslint-disable */
// One-off: apply a CORS configuration to the S3/R2 bucket so the browser can
// upload directly via presigned PUT URLs (school-materials, lecture videos, …).
// Run: node scripts/set-s3-cors.js
require('dotenv').config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

const provider = (process.env.STORAGE_PROVIDER || 's3').toLowerCase();
let bucket, client;

if (provider === 'r2') {
  bucket = process.env.R2_BUCKET_NAME || 'eddva-media';
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error('Missing Cloudflare R2 credentials (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) in environment.');
    process.exit(1);
  }

  console.log(`Configuring Cloudflare R2 bucket: ${bucket} (Account: ${accountId})`);
  client = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
} else {
  bucket = process.env.S3_BUCKET_NAME || 'eddva';
  const region = process.env.AWS_REGION || 'ap-south-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error('Missing AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) in environment.');
    process.exit(1);
  }

  console.log(`Configuring AWS S3 bucket: ${bucket} (${region})`);
  client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

// S3/R2 allows a single "*" wildcard per origin string. We list bare hosts and a
// wildcard variant so tenant subdomains (odm.localhost, foo.eddva.in, …) match.
const CORSRules = [
  {
    ID: 'browser-presigned-uploads',
    AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
    AllowedOrigins: [
      'http://localhost:8080',
      'http://*.localhost:8080',
      'http://localhost:5173',
      'http://*.localhost:5173',
      'http://localhost:3000',
      'https://eddva.in',
      'https://*.eddva.in',
    ],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3000,
  },
];

(async () => {
  console.log(`Applying CORS configuration…`);
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules } }));
  console.log('✓ CORS applied successfully. Fetching current config to verify:');
  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(JSON.stringify(current.CORSRules, null, 2));
})().catch((err) => {
  console.error('Failed to set bucket CORS:', err.name, '-', err.message);
  process.exit(1);
});
