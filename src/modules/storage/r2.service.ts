import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

/** Bandwidth/resolution presets used to build the HLS master playlist. */
const QUALITY_VARIANTS: Record<string, { bandwidth: number; resolution: string }> = {
  '360p': { bandwidth: 400000, resolution: '640x360' },
  '480p': { bandwidth: 800000, resolution: '854x480' },
  '720p': { bandwidth: 1500000, resolution: '1280x720' },
  '1080p': { bandwidth: 4000000, resolution: '1920x1080' },
};

/**
 * Cloudflare R2 (S3-compatible) client used by the live-broadcast pipeline.
 * Kept separate from the AWS S3Service because R2 uses a different endpoint
 * and credentials, and serves the live/recordings buckets behind a CDN.
 */
@Injectable()
export class R2Service implements OnModuleInit {
  private readonly logger = new Logger(R2Service.name);
  private client: S3Client;

  liveBucket: string;
  recordingsBucket: string;
  cdnDomain: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const cfg = this.config.get('storage.r2');
    this.liveBucket = cfg.liveBucket;
    this.recordingsBucket = cfg.recordingsBucket;
    this.cdnDomain = cfg.cdnDomain;

    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) {
      this.logger.warn('R2 credentials are not fully configured — signed URLs/uploads will fail.');
    }

    this.client = new S3Client({
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      ...(cfg.accessKeyId && cfg.secretAccessKey ? {
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        }
      } : {}),
      // R2 doesn't support the CRC32 checksum header the v3 SDK adds by default.
      requestChecksumCalculation: 'WHEN_REQUIRED' as any,
      responseChecksumValidation: 'WHEN_REQUIRED' as any,
    });
  }

  /** Time-limited signed GET URL for a private object. */
  async getSignedUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string> {
    const cfg = this.config.get('storage.r2');
    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
      this.logger.warn(`Skipping presign for ${key} because R2 credentials are not configured.`);
      return `https://${this.cdnDomain || 'cdn.localhost'}/${key}`;
    }
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client as any, command as any, { expiresIn: expiresInSeconds });
  }

  /** Upload an object (buffer/string/stream). `contentLength` is required for streams. */
  async putObject(
    bucket: string,
    key: string,
    body: Buffer | string | Readable,
    contentType: string,
    cacheControl?: string,
    contentLength?: number,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body as any,
        ContentType: contentType,
        CacheControl: cacheControl,
        ContentLength: contentLength,
      }),
    );
  }

  /**
   * Build and upload the HLS master playlist that references each quality
   * variant's media playlist. Served with a short cache so players pick up
   * the variants as soon as the stream starts.
   */
  async generateAndUploadMasterPlaylist(
    instId: string,
    streamKey: string,
    qualities: string[],
  ): Promise<void> {
    const ordered = ['360p', '480p', '720p', '1080p'].filter(
      (q) => qualities.includes(q) && QUALITY_VARIANTS[q],
    );

    let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n';
    for (const q of ordered) {
      const { bandwidth, resolution } = QUALITY_VARIANTS[q];
      m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
      m3u8 += `${q}/index.m3u8\n`;
    }

    await this.putObject(
      this.liveBucket,
      `live/${instId}/${streamKey}/master.m3u8`,
      m3u8,
      'application/vnd.apple.mpegurl',
      'public, max-age=3, s-maxage=3',
    );
  }
}
