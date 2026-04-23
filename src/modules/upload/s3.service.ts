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
  private static readonly PRESIGN_TTL_SECONDS = 7200; // 2 hours — needed for large video uploads

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

  /** Generate a presigned GET URL so private S3 objects can be downloaded by the browser. */
  async presignDownload(key: string, filename?: string): Promise<string> {
    const disposition = filename
      ? `attachment; filename="${filename.replace(/"/g, '')}"`
      : 'attachment';
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: disposition,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  /** Presigned GET URL with configurable TTL (e.g. study material full PDF download). */
  async presignGet(key: string, expiresIn = 900): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /** Fetch object bytes from S3 (server-side PDF processing, etc.). */
  async getBuffer(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = out.Body;
    if (!body) {
      throw new Error(`S3 GetObject returned empty body for key: ${key}`);
    }
    const stream = body as NodeReadable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Extract the S3 object key from a public URL previously returned by toPublicUrl(). */
  keyFromUrl(publicUrl: string): string {
    const base = this.publicUrl
      ? this.publicUrl.replace(/\/$/, '')
      : `https://${this.bucket}.s3.${this.config.get<string>('storage.s3.region')}.amazonaws.com`;
    return publicUrl.replace(`${base}/`, '');
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
