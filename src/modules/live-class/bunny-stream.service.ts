import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface BunnyStreamCredentials {
  videoId: string;
  streamKey: string;
  hlsUrl: string;
  rtmpUrl: string;
  libraryId: string;
}

const BUNNY_API = 'https://video.bunnycdn.com';

@Injectable()
export class BunnyStreamService {
  private readonly logger = new Logger(BunnyStreamService.name);
  private readonly apiKey: string;
  private readonly libraryId: string;
  private readonly cdnHostname: string;
  private readonly rtmpEndpoint: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get('BUNNY_API_KEY', '');
    this.libraryId = config.get('BUNNY_STREAM_LIBRARY_ID', '');
    this.cdnHostname = config.get('BUNNY_CDN_HOSTNAME', '');
    this.rtmpEndpoint = config.get('BUNNY_RTMP_ENDPOINT', 'rtmp://live.bunnycdn.com/live');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async createLiveStream(title: string): Promise<BunnyStreamCredentials | null> {
    if (!this.isConfigured()) {
      this.logger.warn('BunnyStreamService not configured — skipping createLiveStream');
      return null;
    }
    try {
      const create = await axios.post(
        `${BUNNY_API}/library/${this.libraryId}/videos`,
        { title },
        { headers: this.headers() },
      );
      const videoId: string = create.data.guid;

      const detail = await axios.get(
        `${BUNNY_API}/library/${this.libraryId}/videos/${videoId}`,
        { headers: this.headers() },
      );
      const streamKey: string = detail.data.storageEncryptionKey || videoId;

      return {
        videoId,
        streamKey,
        hlsUrl: this.getHlsUrl(videoId),
        rtmpUrl: this.getRtmpUrl(),
        libraryId: this.libraryId,
      };
    } catch (err: any) {
      this.logger.warn(`createLiveStream failed: ${err?.message}`);
      return null;
    }
  }

  async deleteStream(videoId: string): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      await axios.delete(
        `${BUNNY_API}/library/${this.libraryId}/videos/${videoId}`,
        { headers: this.headers() },
      );
    } catch (err: any) {
      this.logger.warn(`deleteStream(${videoId}) failed: ${err?.message}`);
    }
  }

  async getStreamStatus(videoId: string): Promise<{ isLive: boolean; viewerCount: number; hlsUrl: string }> {
    if (!this.isConfigured()) return { isLive: false, viewerCount: 0, hlsUrl: '' };
    try {
      const res = await axios.get(
        `${BUNNY_API}/library/${this.libraryId}/videos/${videoId}`,
        { headers: this.headers() },
      );
      return {
        isLive: res.data.status === 5,  // Bunny status 5 = currently live
        viewerCount: res.data.views || 0,
        hlsUrl: this.getHlsUrl(videoId),
      };
    } catch {
      return { isLive: false, viewerCount: 0, hlsUrl: '' };
    }
  }

  /**
   * Poll until Bunny finishes encoding the recorded stream (status 4 = Finished).
   * Fires and forgets — caller does not await.
   *
   * @param videoId   Bunny video GUID
   * @param onReady   Callback with the final MP4 URL once encoding completes
   * @param maxWaitMs Max total wait time (default 30 min — enough for long lectures)
   */
  async waitForRecordingAsync(
    videoId: string,
    onReady: (mp4Url: string) => Promise<void>,
    maxWaitMs = 30 * 60 * 1000,
  ): Promise<void> {
    const intervalMs = 30_000; // poll every 30 s
    const maxTries = Math.ceil(maxWaitMs / intervalMs);
    let tries = 0;

    const poll = async () => {
      if (!this.isConfigured()) return;
      try {
        const res = await axios.get(
          `${BUNNY_API}/library/${this.libraryId}/videos/${videoId}`,
          { headers: this.headers() },
        );
        const status: number = res.data.status ?? -1;
        this.logger.debug(`Bunny recording poll — videoId=${videoId} status=${status} try=${tries}`);

        if (status === 4) {
          // Finished — use the high-res MP4 URL
          const mp4Url = `https://${this.cdnHostname}/${videoId}/play_720p.mp4`;
          this.logger.log(`Bunny recording ready: ${mp4Url}`);
          await onReady(mp4Url);
          return;
        }

        tries += 1;
        if (tries < maxTries) {
          setTimeout(poll, intervalMs);
        } else {
          this.logger.warn(`Bunny recording timed out after ${maxTries} polls for videoId=${videoId}`);
        }
      } catch (err: any) {
        this.logger.warn(`waitForRecordingAsync poll error: ${err?.message}`);
      }
    };

    setTimeout(poll, intervalMs);
  }

  getHlsUrl(videoId: string): string {
    return `https://${this.cdnHostname}/${videoId}/playlist.m3u8`;
  }

  getRtmpUrl(): string {
    return `${this.rtmpEndpoint}/${this.libraryId}`;
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.libraryId && this.cdnHostname);
  }

  private headers() {
    return { AccessKey: this.apiKey, 'Content-Type': 'application/json' };
  }
}
