import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { extname } from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const r2 = config.get('storage.r2') as {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucketName: string;
      publicUrl: string;
    };

    this.bucket = r2.bucketName;
    this.publicUrl = r2.publicUrl.replace(/\/$/, '');

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    });
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
      this.logger.error(`R2 upload failed [${key}]: ${msg}`);
      throw new InternalServerErrorException('File upload failed');
    }

    const url = `${this.publicUrl}/${key}`;
    this.logger.log(`Uploaded ${key} → ${url}`);
    return { url, key };
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.log(`Deleted R2 object: ${key}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`R2 delete failed [${key}]: ${msg}`);
    }
  }

  keyFromUrl(url: string): string | null {
    const prefix = this.publicUrl + '/';
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
