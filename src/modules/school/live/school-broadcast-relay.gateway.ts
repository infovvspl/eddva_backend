import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import { spawn, ChildProcess } from 'child_process';

import { SchoolLiveService } from './school-live.service';

interface RelaySession {
  proc: ChildProcess;
  sessionId: string;
  streamKey: string;
  startedAt: Date;
}

/**
 * SchoolBroadcastRelayGateway
 *
 * Lets a school teacher go live from the browser WITHOUT OBS. The teacher's
 * browser composites screen share / whiteboard / slides into a single canvas,
 * captures it with mic audio, and streams WebM chunks here via Socket.io. We
 * pipe those chunks through ffmpeg (re-encode to H.264/AAC) and push the FLV
 * stream to the SAME nginx-rtmp ingest OBS uses (`rtmp://<serverIp>/live/<key>`).
 *
 * Because the RTMP target is identical to the OBS path, everything downstream is
 * unchanged: nginx `validateStream` accepts it, transcodes to HLS, students watch
 * via the existing HLS proxy, and on stream-end the recording → R2 → AI notes/MCQ
 * pipeline runs exactly as before.
 *
 * Namespace: /school-broadcast
 *
 * Client flow:
 *   emit('broadcast:start', { token, sessionId, streamKey })
 *     → 'broadcast:started' once ffmpeg is running
 *   emit('broadcast:chunk', <ArrayBuffer>)   ← MediaRecorder ondataavailable
 *   emit('broadcast:stop')
 *
 * Server → client events:
 *   'broadcast:started'     — ffmpeg is running, stream is live
 *   'broadcast:stopped'     — ffmpeg shut down cleanly
 *   'broadcast:relay-error' — { message } — auth/validation failure or ffmpeg crash
 *   'broadcast:relay-ended' — { code }    — ffmpeg exited (RTMP side closed)
 *
 * Unlike the coaching `BroadcastRelayGateway`, this gateway does NOT accept an
 * arbitrary rtmpUrl from the client — the ingest base is derived server-side and
 * the stream key is verified to belong to the caller's institute first.
 */
@WebSocketGateway({ namespace: '/school-broadcast', cors: { origin: '*' } })
export class SchoolBroadcastRelayGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SchoolBroadcastRelayGateway.name);
  private readonly sessions = new Map<string, RelaySession>();
  private readonly ffmpegPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly svc: SchoolLiveService,
  ) {
    this.ffmpegPath = config.get<string>('FFMPEG_PATH', 'ffmpeg');
  }

  handleDisconnect(client: Socket) {
    this.terminateSession(client.id, 'client-disconnect');
  }

  /** Verify a school JWT (same scheme as SchoolLiveGateway / SchoolAuthService). */
  private verify(token?: string): { id: string; role: string; instituteId: string | null } | null {
    if (!token) return null;
    const jwtSecret =
      process.env.SCHOOL_JWT_SECRET ||
      (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_school' : 'dev_school_secret_change_in_prod');
    try {
      const d: any = jwt.verify(token.replace(/^Bearer\s+/i, ''), jwtSecret);
      const id = d.id || d.sub;
      if (!id) return null;
      const instituteId = d.instituteId || d.institute_id || d.tenantId || null;
      return { id, role: String(d.role || '').toUpperCase(), instituteId };
    } catch {
      return null;
    }
  }

  private isTeacher(role: string) {
    // Accounts can carry multiple roles as a comma/space-separated string
    // (e.g. "TEACHER,INSTITUTE_ADMIN"), so match on any single role.
    const roles = String(role || '').toUpperCase().split(/[,\s]+/).filter(Boolean);
    return roles.some((r) => r === 'TEACHER' || r === 'INSTITUTE_ADMIN' || r === 'SUPER_ADMIN');
  }

  @SubscribeMessage('broadcast:start')
  async handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string; sessionId: string; streamKey: string; width?: number; height?: number },
  ) {
    const { token, sessionId, streamKey, width, height } = data ?? ({} as any);
    if (!sessionId || !streamKey) {
      client.emit('broadcast:relay-error', { message: 'Missing sessionId or streamKey' });
      return;
    }

    // ── Auth: must be a teacher/admin whose institute owns this stream key ──
    const user = this.verify(token);
    if (!user) {
      this.logger.warn(`[relay] auth failed — token ${token ? `present(len=${token.length}) but invalid/expired` : 'MISSING'}`);
      client.emit('broadcast:relay-error', {
        message: token
          ? 'Your session is invalid or expired. Refresh the page and log in again.'
          : 'No login token was received. Refresh the page and try again.',
      });
      return;
    }
    if (!this.isTeacher(user.role)) {
      this.logger.warn(`[relay] role rejected: role="${user.role}" user=${user.id}`);
      client.emit('broadcast:relay-error', {
        message: `This account cannot broadcast (role: ${user.role || 'unknown'}). A teacher or admin account is required.`,
      });
      return;
    }
    const owns = await this.svc.verifyStreamOwnership(streamKey, user.instituteId);
    if (!owns) {
      this.logger.warn(`[relay] ownership failed: key=${streamKey} institute=${user.instituteId}`);
      client.emit('broadcast:relay-error', {
        message: 'This live class does not belong to your institute (or the stream key is invalid).',
      });
      return;
    }
    this.logger.log(`[relay] authorized: user=${user.id} role=${user.role} institute=${user.instituteId} key=${streamKey}`);

    // Kill any existing relay for this client before starting a new one
    this.terminateSession(client.id, 'restart');

    const pushUrl = `${this.svc.rtmpIngestBase}/${streamKey}`;

    // Encode to the resolution the browser sent so we never upscale. Screen
    // content is detail-heavy, so bitrate scales with resolution: 1080p→6Mbps,
    // anything smaller (720p) → 3Mbps. Defaults to 1080p when unspecified.
    const targetH = Number(height) && Number(height) <= 720 ? 720 : 1080;
    const targetW = targetH === 720 ? 1280 : 1920;
    const vBitrate = targetH >= 1080 ? '6000k' : '3000k';
    const vBufsize = targetH >= 1080 ? '12000k' : '6000k';
    this.logger.log(`Starting school browser relay: session=${sessionId} key=${streamKey} @ ${targetW}x${targetH} (in=${width}x${height})`);

    const ffmpegArgs = [
      // Input: read WebM from stdin
      '-fflags', '+nobuffer+genpts',
      '-flags', 'low_delay',
      '-analyzeduration', '0',
      '-probesize', '32',
      '-i', 'pipe:0',

      // Video: re-encode to H.264 (required for RTMP/FLV) at the browser's
      // resolution so shared screens (small text/code) stay legible.
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-g', '48',
      '-bf', '0',
      '-b:v', vBitrate,
      '-maxrate', vBitrate,
      '-bufsize', vBufsize,
      '-pix_fmt', 'yuv420p',
      '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2`,

      // Audio: re-encode to AAC (required for RTMP/FLV)
      '-c:a', 'aac',
      '-ar', '44100',
      '-b:a', '128k',
      '-ac', '2',

      // Output: FLV container → RTMP push
      '-f', 'flv',
      pushUrl,
    ];

    try {
      const proc = spawn(this.ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString();
        if (line.includes('fps=') || line.toLowerCase().includes('error') || line.includes('warning')) {
          this.logger.debug(`[ffmpeg:${sessionId}] ${line.slice(0, 200).trim()}`);
        }
      });

      proc.on('close', (code) => {
        this.logger.log(`ffmpeg exited for session=${sessionId} code=${code}`);
        this.sessions.delete(client.id);
        client.emit('broadcast:relay-ended', { code });
      });

      proc.on('error', (err) => {
        this.logger.error(`ffmpeg spawn error session=${sessionId}: ${err.message}`);
        this.sessions.delete(client.id);
        client.emit('broadcast:relay-error', { message: `ffmpeg error: ${err.message}` });
      });

      this.sessions.set(client.id, { proc, sessionId, streamKey, startedAt: new Date() });
      client.emit('broadcast:started', { sessionId });
      this.logger.log(`ffmpeg spawned OK for session=${sessionId}`);
    } catch (err: any) {
      this.logger.error(`Failed to spawn ffmpeg: ${err.message}`);
      client.emit('broadcast:relay-error', {
        message: `ffmpeg not available on this server. Install ffmpeg and set FFMPEG_PATH in .env. Error: ${err.message}`,
      });
    }
  }

  @SubscribeMessage('broadcast:chunk')
  handleChunk(@ConnectedSocket() client: Socket, @MessageBody() data: Buffer) {
    const session = this.sessions.get(client.id);
    if (!session) return;
    try {
      if (session.proc.stdin?.writable) {
        session.proc.stdin.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
    } catch (err: any) {
      this.logger.warn(`Chunk write failed session=${session.sessionId}: ${err.message}`);
    }
  }

  @SubscribeMessage('broadcast:stop')
  handleStop(@ConnectedSocket() client: Socket) {
    this.terminateSession(client.id, 'teacher-stop');
    client.emit('broadcast:stopped', {});
  }

  private terminateSession(clientId: string, reason: string) {
    const session = this.sessions.get(clientId);
    if (!session) return;
    this.logger.log(`Terminating relay session=${session.sessionId} reason=${reason}`);
    try {
      // End stdin gracefully so ffmpeg can flush, force-kill after 3s
      session.proc.stdin?.end();
      const killTimer = setTimeout(() => {
        try { session.proc.kill('SIGKILL'); } catch {}
      }, 3000);
      session.proc.once('close', () => clearTimeout(killTimer));
    } catch {}
    this.sessions.delete(clientId);
  }
}
