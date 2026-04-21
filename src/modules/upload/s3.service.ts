import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable as NodeReadable } from 'stream';

export interface PresignResult {
  uploadUrl: string;
  fileUrl: string;
}

@Injectable()
export class S3Service implements OnModuleInit {
  private static readonly PRESIGN_TTL_SECONDS = 300;

  private readonly logger = new Logger(S3Service.name);
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const cfg = this.config.get('storage.s3');
    this.bucket = cfg.bucketName;
    this.publicUrl = cfg.publicUrl;

    this.client = new S3Client({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // SDK v3.729+ adds x-amz-checksum-crc32 to presigned URLs by default.
      // Browsers can't compute/send that header, so S3 rejects the PUT.
      // Setting WHEN_REQUIRED disables the automatic checksum injection.
      requestChecksumCalculation: 'WHEN_REQUIRED' as any,
      responseChecksumValidation: 'WHEN_REQUIRED' as any,
    });

    await this.validateBucket();
  }

  async presign(key: string, contentType: string): Promise<PresignResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: S3Service.PRESIGN_TTL_SECONDS,
    });

    return {
      uploadUrl,
      fileUrl: this.toPublicUrl(key),
    };
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return this.toPublicUrl(key);
  }

  /** Stream upload (e.g. from multer diskStorage) — avoids loading large videos into memory. */
  async uploadStream(key: string, body: Readable, contentType: string): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      body.destroy();
      throw err;
    }

    return this.toPublicUrl(key);
  }

  /** Generate a time-limited pre-signed GET URL (for enrolled-student downloads). */
  async presignGet(key: string, expiresIn = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: 'attachment',
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /** Fetch an S3 object and return its full buffer (used for PDF page extraction). */
  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = res.Body as NodeReadable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /** Extract the S3 key from a public URL (reverses toPublicUrl). */
  keyFromUrl(url: string): string {
    const base = this.publicUrl
      ? this.publicUrl.replace(/\/$/, '')
      : `https://${this.bucket}.s3.${this.config.get<string>('storage.s3.region')}.amazonaws.com`;
    return url.replace(`${base}/`, '');
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted S3 object: ${key}`);
  }

  toPublicUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    }

    const region = this.config.get<string>('storage.s3.region');
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  private async validateBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`S3 bucket "${this.bucket}" (${this.config.get('storage.s3.region')}) connected`);
    } catch (err) {
      this.logger.error(
        `S3 bucket "${this.bucket}" not reachable: ${err.name}: ${err.message}. ` +
        'Check AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET_NAME.',
      );
    }
  }
}
