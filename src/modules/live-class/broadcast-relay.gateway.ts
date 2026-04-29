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
import { Server, Socket } from 'socket.io';
import { spawn, ChildProcess } from 'child_process';

interface RelaySession {
  proc: ChildProcess;
  sessionId: string;
  startedAt: Date;
}

/**
 * BroadcastRelayGateway
 *
 * Receives binary WebM chunks from a teacher's browser via Socket.io,
 * pipes them to an ffmpeg child process which re-encodes to H.264/AAC
 * and pushes the FLV stream to Bunny.net RTMP ingest.
 *
 * Namespace: /broadcast
 *
 * Client flow:
 *   emit('broadcast:start', { sessionId, rtmpUrl, streamKey })
 *   → server responds with 'broadcast:started'
 *   emit('broadcast:chunk', <ArrayBuffer>)   ← MediaRecorder ondataavailable
 *   emit('broadcast:stop')
 *
 * Server events to client:
 *   'broadcast:started'    — ffmpeg is running, stream is live
 *   'broadcast:stopped'    — ffmpeg has shut down cleanly
 *   'broadcast:relay-error'— { message } — ffmpeg failed to start or crashed
 *   'broadcast:relay-ended'— { code }    — ffmpeg exited (stream ended from RTMP side)
 */
@WebSocketGateway({ namespace: '/broadcast', cors: { origin: '*' } })
export class BroadcastRelayGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BroadcastRelayGateway.name);
  private readonly sessions = new Map<string, RelaySession>();
  private readonly ffmpegPath: string;

  constructor(private readonly config: ConfigService) {
    this.ffmpegPath = config.get<string>('FFMPEG_PATH', 'ffmpeg');
  }

  handleDisconnect(client: Socket) {
    this.terminateSession(client.id, 'client-disconnect');
  }

  @SubscribeMessage('broadcast:start')
  handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; rtmpUrl: string; streamKey: string },
  ) {
    const { sessionId, rtmpUrl, streamKey } = data ?? {};
    if (!sessionId || !rtmpUrl || !streamKey) {
      client.emit('broadcast:relay-error', { message: 'Missing sessionId, rtmpUrl or streamKey' });
      return;
    }

    // Kill any existing relay for this client before starting a new one
    this.terminateSession(client.id, 'restart');

    const pushUrl = `${rtmpUrl}/${streamKey}`;
    this.logger.log(`Starting broadcast relay: session=${sessionId} → ${pushUrl}`);

    const ffmpegArgs = [
      // Input: read WebM from stdin
      '-fflags', '+nobuffer+genpts',
      '-flags', 'low_delay',
      '-analyzeduration', '0',
      '-probesize', '32',
      '-i', 'pipe:0',

      // Video: re-encode to H.264 (required for RTMP/FLV)
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-g', '30',          // keyframe every 30 frames
      '-bf', '0',          // no B-frames for lower latency
      '-b:v', '1200k',
      '-maxrate', '1200k',
      '-bufsize', '2400k',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',

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
      const proc = spawn(this.ffmpegPath, ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString();
        // Only surface errors and progress lines — not the flood of codec config lines
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

      this.sessions.set(client.id, { proc, sessionId, startedAt: new Date() });
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
  handleChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Buffer,
  ) {
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
      // End stdin gracefully so ffmpeg can flush
      session.proc.stdin?.end();
      // Force-kill after 3 s if it hasn't exited
      const killTimer = setTimeout(() => {
        try { session.proc.kill('SIGKILL'); } catch {}
      }, 3000);
      session.proc.once('close', () => clearTimeout(killTimer));
    } catch {}
    this.sessions.delete(clientId);
  }
}
