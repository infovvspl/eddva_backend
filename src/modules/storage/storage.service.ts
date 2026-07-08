import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import type { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const provider = (config.get<string>('storage.provider') || 's3').toLowerCase();

    if (provider === 'r2') {
      const r2 = config.get('storage.r2') as {
        accountId: string; accessKeyId: string; secretAccessKey: string;
        bucketName: string; publicUrl: string;
      };
      this.bucket = r2.bucketName;
      this.publicUrl = (r2.publicUrl || '').replace(/\/$/, '');
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        ...(r2.accessKeyId && r2.secretAccessKey ? {
          credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey }
        } : {}),
      });
    } else {
      // Default: AWS S3
      const s3 = config.get('storage.s3') as {
        region: string; accessKeyId: string; secretAccessKey: string;
        bucketName: string; publicUrl: string;
      };
      this.bucket = s3.bucketName;
      // Fall back to the standard S3 virtual-hosted URL when no CDN/public URL is set
      this.publicUrl = (s3.publicUrl || `https://${s3.bucketName}.s3.${s3.region}.amazonaws.com`).replace(/\/$/, '');
      this.s3 = new S3Client({
        region: s3.region,
        ...(s3.accessKeyId && s3.secretAccessKey ? {
          credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
        } : {}),
      });
    }
  }

  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    folder: string = 'resources',
  ): Promise<{ url: string; key: string }> {
    const ext = extname(originalName) || '.bin';
    const key = `${folder}/${randomBytes(8).toString('hex')}${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          CacheControl: 'public, max-age=31536000',
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Storage upload failed [${key}]: ${msg}`);
      throw new InternalServerErrorException('File upload failed');
    }

    const url = `${this.publicUrl}/${key}`;
    this.logger.log(`Uploaded ${key} → ${url}`);
    return { url, key };
  }

  /** Stream-upload a large file (video/audio) without buffering in RAM. */
  async putStream(
    key: string,
    body: Readable,
    contentType: string,
    contentLength: number,
  ): Promise<string> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body as any,
          ContentType: contentType,
          ContentLength: contentLength,
          CacheControl: 'public, max-age=31536000',
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Storage stream-upload failed [${key}]: ${msg}`);
      throw new InternalServerErrorException('File upload failed');
    }
    const url = `${this.publicUrl}/${key}`;
    this.logger.log(`Uploaded ${key} → ${url}`);
    return url;
  }

  /** Generate a time-limited signed GET URL for a private object. */
  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const provider = (this.config.get<string>('storage.provider') || 's3').toLowerCase();
    const cfg = this.config.get(`storage.${provider}`) as any;
    if (!cfg?.accessKeyId || !cfg?.secretAccessKey) {
      this.logger.warn(`Skipping presign for ${key} because credentials are not configured.`);
      return `${this.publicUrl}/${key}`;
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3 as any, command as any, { expiresIn: expiresInSeconds });
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.log(`Deleted storage object: ${key}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Storage delete failed [${key}]: ${msg}`);
    }
  }

  keyFromUrl(url: string): string | null {
    const prefix = this.publicUrl + '/';
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
