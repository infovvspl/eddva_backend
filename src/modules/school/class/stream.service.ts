import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StreamCopyResult {
  uid: string;
  hls: string | null;
  dash: string | null;
  thumbnail: string | null;
  readyToStream: boolean;
  state: string;
}

/**
 * Cloudflare Stream — off-infrastructure video transcoding + adaptive-HLS CDN.
 *
 * The app server is a burstable EC2 that cannot transcode without pegging its CPU
 * credits, so heavy encoding is offloaded here. We use Stream's "copy from URL":
 * the raw upload still lands in R2 (existing flow, unchanged), then Stream pulls
 * it from the public media.eddva.in URL, transcodes to multiple qualities, and
 * serves adaptive HLS from its own global CDN. Playback then uses the HLS URL.
 *
 * Entirely env-gated: with no credentials the service is inert and the caller
 * falls back to plain R2 playback, so enabling Stream is purely additive.
 */
@Injectable()
export class CloudflareStreamService {
  private readonly logger = new Logger(CloudflareStreamService.name);
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly base: string;

  constructor(config: ConfigService) {
    this.accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || config.get('cloudflare.accountId') || '').trim();
    this.apiToken = (process.env.CLOUDFLARE_STREAM_API_TOKEN || config.get('cloudflare.streamToken') || '').trim();
    this.base = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream`;
  }

  /** True only when both the account id and an API token are configured. */
  isConfigured(): boolean {
    return Boolean(this.accountId && this.apiToken);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' };
  }

  private normalise(result: any): StreamCopyResult {
    const pb = result?.playback || {};
    return {
      uid: result?.uid,
      hls: pb.hls ?? null,
      dash: pb.dash ?? null,
      thumbnail: result?.thumbnail ?? null,
      readyToStream: Boolean(result?.readyToStream),
      state: result?.status?.state ?? 'unknown',
    };
  }

  /**
   * Ask Stream to ingest a video from a public URL. Returns the new video's uid
   * and (once ready) its HLS/thumbnail URLs. Throws on API failure so the caller
   * can record a failed state and fall back to R2.
   */
  async copyFromUrl(sourceUrl: string, name: string): Promise<StreamCopyResult> {
    if (!this.isConfigured()) throw new Error('Cloudflare Stream is not configured');
    const res = await fetch(`${this.base}/copy`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ url: sourceUrl, meta: { name: (name || 'lecture').slice(0, 1024) } }),
      signal: AbortSignal.timeout(30_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      const msg = body?.errors?.map((e: any) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(`Stream copy failed: ${msg}`);
    }
    return this.normalise(body.result);
  }

  /** Poll one video's transcode status. */
  async getStatus(uid: string): Promise<StreamCopyResult> {
    if (!this.isConfigured()) throw new Error('Cloudflare Stream is not configured');
    const res = await fetch(`${this.base}/${uid}`, {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      const msg = body?.errors?.map((e: any) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(`Stream status failed: ${msg}`);
    }
    return this.normalise(body.result);
  }

  /** Delete a Stream video (used when replacing or cleaning up). Best-effort. */
  async delete(uid: string): Promise<boolean> {
    if (!this.isConfigured() || !uid) return false;
    try {
      const res = await fetch(`${this.base}/${uid}`, {
        method: 'DELETE',
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(`Stream delete failed for ${uid}: ${(err as Error).message}`);
      return false;
    }
  }
}
