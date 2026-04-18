import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcRole, RtcTokenBuilder } from 'agora-token';

// AWS S3 region codes as defined by Agora Cloud Recording API
const AGORA_S3_REGION: Record<string, number> = {
  'us-east-1': 0,
  'us-east-2': 1,
  'us-west-1': 2,
  'us-west-2': 3,
  'eu-west-1': 4,
  'eu-central-1': 5,
  'ap-southeast-1': 6,
  'ap-southeast-2': 7,
  'ap-northeast-1': 8,
  'ap-northeast-2': 9,
  'ap-south-1': 10,
  'ca-central-1': 11,
};

const AGORA_RECORDING_API = 'https://api.agora.io/v1/apps';
const RECORDING_UID = '0'; // special UID reserved for cloud recording bot

@Injectable()
export class AgoraService {
  private readonly logger = new Logger(AgoraService.name);

  constructor(private readonly configService: ConfigService) {}

  generateRtcToken(channelName: string, uid: number, role: 'host' | 'audience'): string | null {
    const appId = this.configService.get<string>('AGORA_APP_ID');
    const appCertificate = this.configService.get<string>('AGORA_APP_CERTIFICATE');

    this.logger.debug(
      `generateRtcToken — appId: ${appId?.substring(0, 8)}... cert: ${appCertificate ? appCertificate.substring(0, 8) + '...' : '(empty)'} channel: ${channelName} uid: ${uid} role: ${role}`,
    );

    if (!appId) {
      this.logger.warn('AGORA_APP_ID not set — cannot generate RTC token');
      return null;
    }

    if (!appCertificate) {
      this.logger.warn('AGORA_APP_CERTIFICATE not set — joining without token (App ID only mode)');
      return null;
    }

    const tokenExpireSeconds = 7200; // relative seconds from now (agora-token v2.x)
    const agoraRole = role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      agoraRole,
      tokenExpireSeconds,
      tokenExpireSeconds,
    );
    this.logger.log(`Token generated: ${token.substring(0, 20)}... (${token.length} chars)`);
    return token;
  }

  generateRecordingToken(channelName: string): string | null {
    const appId = this.configService.get<string>('AGORA_APP_ID');
    const appCertificate = this.configService.get<string>('AGORA_APP_CERTIFICATE');
    if (!appId || !appCertificate) return null;

    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      0,
      RtcRole.PUBLISHER,
      86400, // 24h in relative seconds (agora-token v2.x)
      86400,
    );
  }

  generateUid(): number {
    return Math.floor(Math.random() * 100000) + 1000;
  }

  buildChannelName(lectureId: string): string {
    return `apexiq-${lectureId.replace(/-/g, '').substring(0, 12)}`;
  }

  // ─── Cloud Recording ────────────────────────────────────────────────────────

  async acquireRecordingResource(channelName: string): Promise<string | null> {
    const appId = this.configService.get<string>('AGORA_APP_ID', '');
    const auth = this.buildCloudRecordingAuth();
    if (!auth) return null;

    try {
      const res = await fetch(`${AGORA_RECORDING_API}/${appId}/cloud_recording/acquire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          cname: channelName,
          uid: RECORDING_UID,
          clientRequest: { resourceExpiredHour: 24, scene: 0 },
        }),
      });

      if (!res.ok) {
        this.logger.error(`Acquire recording resource failed (${res.status}): ${await res.text()}`);
        return null;
      }

      const data = (await res.json()) as { resourceId?: string };
      this.logger.log(`Recording resource acquired: ${data.resourceId}`);
      return data.resourceId ?? null;
    } catch (err) {
      this.logger.error('acquireRecordingResource threw', err);
      return null;
    }
  }

  async startCloudRecording(
    channelName: string,
    resourceId: string,
    token: string,
    lectureId: string,
  ): Promise<string | null> {
    const appId = this.configService.get<string>('AGORA_APP_ID', '');
    const auth = this.buildCloudRecordingAuth();
    if (!auth) return null;

    const bucket = this.configService.get<string>('S3_BUCKET_NAME', 'eddva');
    const region = this.configService.get<string>('AWS_REGION', 'ap-south-1');
    const accessKey = this.configService.get<string>('AWS_ACCESS_KEY_ID', '');
    const secretKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY', '');

    try {
      const res = await fetch(
        `${AGORA_RECORDING_API}/${appId}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify({
            cname: channelName,
            uid: RECORDING_UID,
            clientRequest: {
              token,
              recordingConfig: {
                maxIdleTime: 30,
                streamTypes: 3, // audio + video
                channelType: 1, // live-broadcast mode
                videoStreamType: 0, // high-quality stream
                transcodingConfig: {
                  width: 1280,
                  height: 720,
                  bitrate: 2260,
                  fps: 15,
                  mixedVideoLayout: 0, // floating layout
                },
              },
              storageConfig: {
                vendor: 1, // AWS S3
                region: AGORA_S3_REGION[region] ?? 10,
                bucket,
                accessKey,
                secretKey,
                fileNamePrefix: ['recordings', lectureId],
              },
            },
          }),
        },
      );

      if (!res.ok) {
        this.logger.error(`Start cloud recording failed (${res.status}): ${await res.text()}`);
        return null;
      }

      const data = (await res.json()) as { sid?: string };
      this.logger.log(`Cloud recording started: sid=${data.sid}`);
      return data.sid ?? null;
    } catch (err) {
      this.logger.error('startCloudRecording threw', err);
      return null;
    }
  }

  async stopCloudRecording(
    channelName: string,
    resourceId: string,
    sid: string,
  ): Promise<string | null> {
    const appId = this.configService.get<string>('AGORA_APP_ID', '');
    const auth = this.buildCloudRecordingAuth();
    if (!auth) return null;

    const bucket = this.configService.get<string>('S3_BUCKET_NAME', 'eddva');
    const region = this.configService.get<string>('AWS_REGION', 'ap-south-1');

    try {
      const res = await fetch(
        `${AGORA_RECORDING_API}/${appId}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify({ cname: channelName, uid: RECORDING_UID, clientRequest: {} }),
        },
      );

      if (!res.ok) {
        this.logger.error(`Stop cloud recording failed (${res.status}): ${await res.text()}`);
        return null;
      }

      const data = (await res.json()) as {
        serverResponse?: {
          fileList?: Array<{ filename: string; isPlayable: boolean }>;
          uploadingStatus?: string;
        };
      };

      const fileList = data?.serverResponse?.fileList;
      if (!Array.isArray(fileList) || fileList.length === 0) {
        this.logger.warn('Cloud recording stopped but no files returned');
        return null;
      }

      // Prefer .mp4 for direct playback; fall back to first file
      const preferred = fileList.find((f) => f.filename?.endsWith('.mp4')) ?? fileList[0];
      const url = `https://${bucket}.s3.${region}.amazonaws.com/${preferred.filename}`;
      this.logger.log(`Recording file: ${url}`);
      return url;
    } catch (err) {
      this.logger.error('stopCloudRecording threw', err);
      return null;
    }
  }

  private buildCloudRecordingAuth(): string | null {
    const customerId = this.configService.get<string>('AGORA_CUSTOMER_ID', '');
    const customerSecret = this.configService.get<string>('AGORA_CUSTOMER_SECRET', '');
    if (!customerId || !customerSecret) {
      this.logger.warn('AGORA_CUSTOMER_ID / AGORA_CUSTOMER_SECRET not set — cloud recording disabled');
      return null;
    }
    return Buffer.from(`${customerId}:${customerSecret}`).toString('base64');
  }
}
