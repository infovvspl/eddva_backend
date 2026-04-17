import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignResult {
  uploadUrl: string;
  fileUrl:   string;
  key:       string;
}

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;
  private expiresIn: number;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const cfg = this.config.get('storage.s3');
    this.bucket    = cfg.bucketName;
    this.publicUrl = cfg.publicUrl;
    this.expiresIn = cfg.presignExpiresIn;

    this.client = new S3Client({
      region: cfg.region,
      credentials: {
        accessKeyId:     cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });

    await this.validateBucket();
  }

  // ── Pre-signed upload URL ─────────────────────────────────────────────────

  async presign(key: string, contentType: string): Promise<PresignResult> {
    const command = new PutObjectCommand({
      Bucket:      this.bucket,
      Key:         key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.expiresIn,
    });

    return { uploadUrl, fileUrl: this.toPublicUrl(key), key };
  }

  // ── Direct upload (backend streams file to S3) ────────────────────────────

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    this.logger.log(`Uploading to S3: ${key} (${buffer.length} bytes, ${contentType})`);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket:      this.bucket,
          Key:         key,
          Body:        buffer,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      this.logger.error(`S3 upload failed for key "${key}": ${err.message}`);
      throw new Error(`S3 upload failed: ${err.message}`);
    }
    const url = this.toPublicUrl(key);
    this.logger.log(`S3 upload success: ${url}`);
    return url;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    this.logger.log(`Deleted S3 object: ${key}`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  toPublicUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    }
    // Default S3 URL when no CDN is configured
    const region = this.config.get<string>('storage.s3.region');
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  keyFromUrl(fileUrl: string): string {
    // Works for both CDN URLs and native S3 URLs
    if (this.publicUrl) {
      return fileUrl.replace(`${this.publicUrl.replace(/\/$/, '')}/`, '');
    }
    const region = this.config.get<string>('storage.s3.region');
    const prefix = `https://${this.bucket}.s3.${region}.amazonaws.com/`;
    return fileUrl.replace(prefix, '');
  }

  private async validateBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`S3 bucket "${this.bucket}" (${this.config.get('storage.s3.region')}) — connected ✓`);
    } catch (err) {
      this.logger.error(
        `S3 bucket "${this.bucket}" NOT reachable — ${err.name}: ${err.message}. ` +
        `Check AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME in .env`,
      );
    }
  }
}
