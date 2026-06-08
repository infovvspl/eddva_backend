/* eslint-disable */
// One-off: apply a CORS configuration to the S3 bucket so the browser can
// upload directly via presigned PUT URLs (school-materials, lecture videos, …).
// Run: node scripts/set-s3-cors.js
require('dotenv').config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

const region = process.env.AWS_REGION || 'ap-south-1';
const bucket = process.env.S3_BUCKET_NAME || 'eddva';

const client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// S3 allows a single "*" wildcard per origin string. We list bare hosts and a
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
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Missing AWS credentials in environment (.env).');
    process.exit(1);
  }
  console.log(`Applying CORS to s3://${bucket} (${region})…`);
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules } }));
  console.log('✓ CORS applied. Current config:');
  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(JSON.stringify(current.CORSRules, null, 2));
})().catch((err) => {
  console.error('Failed to set bucket CORS:', err.name, '-', err.message);
  if (err.name === 'AccessDenied') {
    console.error('The IAM user needs s3:PutBucketCors on this bucket (or apply CORS in the AWS console).');
  }
  process.exit(1);
});
