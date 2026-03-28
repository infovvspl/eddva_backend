import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcRole, RtcTokenBuilder } from 'agora-token';

@Injectable()
export class AgoraService {
  private readonly logger = new Logger(AgoraService.name);

  constructor(private readonly configService: ConfigService) {}

  generateRtcToken(channelName: string, uid: number, role: 'host' | 'audience'): string {
    const appId = this.configService.get<string>('AGORA_APP_ID');
    const appCertificate = this.configService.get<string>('AGORA_APP_CERTIFICATE');

    if (!appId || !appCertificate) {
      this.logger.warn('AGORA_APP_ID not set — using mock token for development');
      return `DEV_MOCK_TOKEN_${channelName}_${uid}`;
    }

    const expireTime = 7200;
    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expireTime;
    const agoraRole = role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      agoraRole,
      privilegeExpireTime,
      privilegeExpireTime,
    );
  }

  generateUid(): number {
    return Math.floor(Math.random() * 100000) + 1000;
  }

  buildChannelName(lectureId: string): string {
    return `apexiq-${lectureId.replace(/-/g, '').substring(0, 12)}`;
  }
}
