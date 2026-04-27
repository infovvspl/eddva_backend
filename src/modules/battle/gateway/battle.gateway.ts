import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { BattleService } from '../battle.service';
import { PresenceService } from '../../presence/presence.service';

// ── WebSocket Events ──────────────────────────────────────────────────────────
// Client → Server:
//   'battle:join'    { roomCode, studentId }
//   'battle:answer'  { roomCode, questionId, optionId, roundNumber, responseTimeMs }
//   'battle:ready'   { roomCode }
//
// Server → Client:
//   'battle:player_joined'  { participants[] }
//   'battle:start'          { battle, questions[] }
//   'battle:question'       { question, roundNumber, timeLimit }
//   'battle:round_result'   { winnerId, scores, nextQuestion? }
//   'battle:end'            { winnerId, finalScores, eloChanges }
//   'battle:opponent_left'  {}
//   'battle:error'          { message }

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/battle',
})
export class BattleGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BattleGateway.name);

  // Maps socketId → { studentId, roomCode }
  private connectedPlayers = new Map<string, { studentId: string; roomCode: string }>();
  // Lobby presence maps
  private onlineUsers = new Map<string, { socketId: string; studentId: string; tenantId: string; examTarget: string | null }>();
  private socketToStudent = new Map<string, string>();
  private studentSockets = new Map<string, Set<string>>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private pendingChallenges = new Map<
    string,
    {
      challengeId: string;
      fromStudentId: string;
      toStudentId: string;
      tenantId: string;
      timer: NodeJS.Timeout;
      batchId?: string;
      batchName?: string;
      difficulty?: 'easy' | 'medium' | 'hard';
    }
  >();

  constructor(
    private readonly battleService: BattleService,
    private readonly presenceService: PresenceService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('Battle WebSocket Gateway initialised');
    this.refreshTimer = setInterval(() => {
      const tenantIds = new Set(Array.from(this.onlineUsers.values()).map((u) => u.tenantId));
      for (const tenantId of tenantIds) {
        void this.broadcastOnlineUsers(tenantId);
      }
    }, 10_000);
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const disconnectedStudentId = this.socketToStudent.get(client.id);
    if (disconnectedStudentId) {
      this.socketToStudent.delete(client.id);
      const sockets = this.studentSockets.get(disconnectedStudentId);
      if (sockets) {
        sockets.delete(client.id);
        if (!sockets.size) this.studentSockets.delete(disconnectedStudentId);
      }

      const remainingSockets = this.studentSockets.get(disconnectedStudentId);
      const stillOnline = Boolean(remainingSockets && remainingSockets.size > 0);
      const onlineEntry = this.onlineUsers.get(disconnectedStudentId);

      if (!stillOnline) {
        const tenantId = onlineEntry?.tenantId;
        this.onlineUsers.delete(disconnectedStudentId);
        // Keep pending challenges until explicit accept/reject/timeout.
        // Do not auto-cancel on disconnect because brief reconnects during
        // page navigation can otherwise invalidate a still-active challenge.
        if (tenantId) await this.broadcastOnlineUsers(tenantId);
      } else if (onlineEntry?.socketId === client.id) {
        const nextSocketId = Array.from(remainingSockets!)[0];
        this.onlineUsers.set(disconnectedStudentId, { ...onlineEntry, socketId: nextSocketId });
        await this.broadcastOnlineUsers(onlineEntry.tenantId);
      }
    }

    const player = this.connectedPlayers.get(client.id);
    if (player) {
      this.logger.debug(`Player ${player.studentId} disconnected from room ${player.roomCode}`);
      await this.battleService.abandonBattleByRoomCode(player.roomCode);
      // Notify opponent and force-close room on their side
      client.to(player.roomCode).emit('battle:opponent_left', {
        message: 'Battle ended: opponent left the match.',
        reason: 'opponent_left',
        closeRoom: true,
      });
      const tenantIds = this.clearConnectedPlayersByRoom(player.roomCode);
      for (const tenantId of tenantIds) {
        await this.broadcastOnlineUsers(tenantId);
      }
    }

  }

  private normalizeExamTarget(examTarget: string | null | undefined): string | null {
    if (!examTarget) return null;
    return String(examTarget).trim().toLowerCase();
  }

  @SubscribeMessage('lobby:join')
  async handleLobbyJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { studentId: string; tenantId?: string },
  ) {
    if (!data?.studentId) {
      client.emit('battle:error', { message: 'Missing studentId for lobby join' });
      return;
    }

    const resolvedTenantId = await this.battleService.getStudentTenantByStudentId(data.studentId);
    if (!resolvedTenantId) {
      client.emit('battle:error', { message: 'Student tenant not found for lobby join' });
      return;
    }

    const examTarget = this.normalizeExamTarget(
      await this.battleService.getStudentExamTarget(data.studentId),
    );

    this.onlineUsers.set(data.studentId, {
      socketId: client.id,
      studentId: data.studentId,
      tenantId: resolvedTenantId,
      examTarget,
    });
    this.socketToStudent.set(client.id, data.studentId);
    const sockets = this.studentSockets.get(data.studentId) ?? new Set<string>();
    sockets.add(client.id);
    this.studentSockets.set(data.studentId, sockets);
    void this.broadcastOnlineUsers(resolvedTenantId);
  }

  @SubscribeMessage('battle:challenge')
  handleChallengeRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetStudentId: string; fromStudentId: string; tenantId: string; batchId?: string; batchName?: string; difficulty?: 'easy' | 'medium' | 'hard' },
  ) {
    const { targetStudentId, fromStudentId, tenantId: payloadTenantId, batchId, batchName, difficulty } = data ?? {};
    // Prefer onlineUsers entry; fall back to tenantId in payload (survives hot-reload)
    const senderOnline = fromStudentId ? this.onlineUsers.get(fromStudentId) : undefined;
    const tenantId = senderOnline?.tenantId ?? payloadTenantId;

    if (!targetStudentId || !fromStudentId || !tenantId) {
      client.emit('battle:challenge_error', { message: 'Invalid challenge payload' });
      return;
    }

    if (targetStudentId === fromStudentId) {
      client.emit('battle:challenge_error', { message: 'Cannot challenge yourself' });
      return;
    }

    const target = this.onlineUsers.get(targetStudentId);
    if (!target) {
      client.emit('battle:challenge_error', { message: 'Target student is not online' });
      return;
    }

    const challengeId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = setTimeout(() => {
      const pending = this.pendingChallenges.get(challengeId);
      if (!pending) return;
      this.pendingChallenges.delete(challengeId);
      client.emit('battle:challenge_timeout', {
        challengeId,
        targetStudentId,
        fallback: 'bot',
        message: 'No response in 30 seconds. Starting bot battle.',
      });
    }, 30_000);

    this.pendingChallenges.set(challengeId, {
      challengeId,
      fromStudentId,
      toStudentId: targetStudentId,
      tenantId,
      timer: timeout,
      batchId,
      batchName,
      difficulty,
    });

    const targetSockets = this.studentSockets.get(targetStudentId) ?? new Set([target.socketId]);
    for (const sid of targetSockets) {
      this.server.to(sid).emit('battle:incoming_request', {
        challengeId,
        fromStudentId,
        expiresInSeconds: 30,
        batchId,
        batchName,
        difficulty,
      });
    }

    client.emit('battle:challenge_sent', { challengeId, targetStudentId });
    void this.broadcastOnlineUsers(tenantId);
  }

  @SubscribeMessage('battle:challenge_response')
  async handleChallengeResponse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { challengeId: string; accepted: boolean; studentId: string },
  ) {
    const pending = this.pendingChallenges.get(data?.challengeId);
    if (!pending) {
      client.emit('battle:challenge_error', { message: 'Challenge request expired or invalid' });
      return;
    }

    clearTimeout(pending.timer);
    this.pendingChallenges.delete(data.challengeId);

    const sender = this.onlineUsers.get(pending.fromStudentId);
    if (!sender) {
      client.emit('battle:challenge_error', { message: 'Sender is offline' });
      return;
    }

    if (!data.accepted) {
      const senderSockets = this.studentSockets.get(pending.fromStudentId) ?? new Set([sender.socketId]);
      for (const sid of senderSockets) {
        this.server.to(sid).emit('battle:challenge_rejected', {
          challengeId: data.challengeId,
          byStudentId: pending.toStudentId,
          reason: 'Opponent rejected the challenge request.',
        });
      }
      await this.broadcastOnlineUsers(pending.tenantId);
      return;
    }

    try {
      const room = await this.battleService.createPrivateChallengeRoom(
        pending.fromStudentId,
        pending.toStudentId,
        pending.tenantId,
        pending.batchId,
        pending.batchName,
        pending.difficulty,
      );

      // Put both clients in the private socket room and start immediately.
      client.join(room.roomCode);
      (this.server.sockets as any).get(sender.socketId)?.join(room.roomCode);

      this.connectedPlayers.set(client.id, { studentId: pending.toStudentId, roomCode: room.roomCode });
      this.connectedPlayers.set(sender.socketId, { studentId: pending.fromStudentId, roomCode: room.roomCode });

      await this.battleService.startBattle(room.battleId);
      const questions = await this.battleService.getBattleQuestions(room.battleId);
      const challengeParticipants = await this.battleService.getRoomParticipantsFormatted(room.roomCode);

      this.server.to(room.roomCode).emit('battle:start', {
        battle: {
          id: room.battleId,
          roomCode: room.roomCode,
          totalRounds: room.totalRounds ?? 10,
          secondsPerRound: room.secondsPerRound ?? 45,
        },
        room,
        participants: challengeParticipants,
        firstQuestion: questions[0],
        totalRounds: room.totalRounds ?? 10,
        timePerRound: room.secondsPerRound ?? 45,
      });

      const senderSockets = this.studentSockets.get(pending.fromStudentId) ?? new Set([sender.socketId]);
      for (const sid of senderSockets) {
        this.server.to(sid).emit('battle:challenge_accepted', {
          challengeId: data.challengeId,
          room,
        });
      }
      client.emit('battle:challenge_accepted', {
        challengeId: data.challengeId,
        room,
      });
      await this.broadcastOnlineUsers(pending.tenantId);
    } catch (error) {
      const senderSockets = this.studentSockets.get(pending.fromStudentId) ?? new Set([sender.socketId]);
      for (const sid of senderSockets) {
        this.server.to(sid).emit('battle:challenge_error', { message: error.message });
      }
      client.emit('battle:challenge_error', { message: error.message });
    }
  }

  @SubscribeMessage('battle:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; studentId: string },
  ) {
    try {
      const { roomCode, studentId } = data;
      const battle = await this.battleService.joinRoomGateway(roomCode, studentId);

      client.join(roomCode);
      this.connectedPlayers.set(client.id, { studentId, roomCode });
      const tenantId = this.onlineUsers.get(studentId)?.tenantId;
      if (tenantId) await this.broadcastOnlineUsers(tenantId);

      // If battle is already ACTIVE (late-joiner / reconnect), send start only to this socket
      if (battle.status === 'active') {
        const questions = await this.battleService.getBattleQuestions(battle.id);
        const reconnectParticipants = await this.battleService.getRoomParticipantsFormatted(roomCode);
        client.emit('battle:start', {
          battle,
          participants: reconnectParticipants,
          firstQuestion: questions[0],
          totalRounds: battle.totalRounds,
          timePerRound: battle.secondsPerRound,
        });
        return;
      }

      // Notify all in room about new participant (formatted with name + avatarUrl)
      const participants = await this.battleService.getRoomParticipantsFormatted(roomCode);
      this.server.to(roomCode).emit('battle:player_joined', { participants });

      // Start battle only when room is full AND battle is still waiting
      if (participants.length >= battle.maxParticipants) {
        const questions = await this.battleService.getBattleQuestions(battle.id);
        if (!questions.length) {
          client.emit('battle:error', { message: 'Questions not ready yet. Please try again in a moment.' });
          return;
        }
        await this.battleService.startBattle(battle.id);
        this.server.to(roomCode).emit('battle:start', {
          battle,
          participants,
          firstQuestion: questions[0],
          totalRounds: battle.totalRounds,
          timePerRound: battle.secondsPerRound,
        });
      }
    } catch (error) {
      client.emit('battle:error', { message: error.message });
    }
  }

  private async broadcastOnlineUsers(tenantId: string) {
    const tenantUsers = Array.from(this.onlineUsers.values()).filter(u => u.tenantId === tenantId);
    const lobbyStudentIds = tenantUsers.map(u => u.studentId);
    const globallyOnlineStudentIds = await this.presenceService.getOnlineStudentIdsByTenant(tenantId);
    const studentIds = Array.from(new Set([...lobbyStudentIds, ...globallyOnlineStudentIds]));
    const profiles = await this.battleService.getLobbyUsersByStudentIds(studentIds, tenantId);

    const waitingStudentIds = new Set<string>();
    for (const req of this.pendingChallenges.values()) {
      if (req.tenantId !== tenantId) continue;
      waitingStudentIds.add(req.fromStudentId);
      waitingStudentIds.add(req.toStudentId);
    }
    const inBattleStudentIds = new Set(Array.from(this.connectedPlayers.values()).map(v => v.studentId));

    const allUsers = profiles.map(p => ({
      studentId: p.studentId,
      socketId: this.onlineUsers.get(p.studentId)?.socketId ?? '',
      isChallengeable: Boolean(this.onlineUsers.get(p.studentId)?.socketId),
      name: p.name,
      avatarUrl: p.avatarUrl,
      xpPoints: p.xpPoints ?? 0,
      eloRating: p.eloRating,
      tier: p.tier,
      examTarget: this.onlineUsers.get(p.studentId)?.examTarget ?? null,
      status: inBattleStudentIds.has(p.studentId)
        ? 'in_battle'
        : waitingStudentIds.has(p.studentId)
          ? 'waiting'
          : 'online',
      batchIds: p.batchIds,
    }));

    // Show all tenant online users in battle lobby.
    // Do not hide by exam target because users expect same batch/course peers
    // to be visible regardless of preference selection.
    for (const u of tenantUsers) {
      this.server.to(u.socketId).emit('lobby:online_users', { users: allUsers });
    }
  }

  private clearConnectedPlayersByRoom(roomCode: string): Set<string> {
    const tenantIds = new Set<string>();
    for (const [socketId, value] of this.connectedPlayers.entries()) {
      if (value.roomCode !== roomCode) continue;
      this.connectedPlayers.delete(socketId);
      const tenantId = this.onlineUsers.get(value.studentId)?.tenantId;
      if (tenantId) tenantIds.add(tenantId);
    }
    return tenantIds;
  }

  @SubscribeMessage('battle:answer')
  async handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomCode: string;
      battleId: string;
      questionId: string;
      optionId: string;
      roundNumber: number;
      responseTimeMs: number;
      studentId: string;
    },
  ) {
    try {
      const result = await this.battleService.submitAnswer(data);

      // Send round result when both players have answered
      if (result.roundComplete) {
        this.server.to(data.roomCode).emit('battle:round_result', {
          roundNumber: data.roundNumber,
          winnerId: result.roundWinnerId,
          correctOptionId: result.correctOptionId,
          scores: result.scores,
        });

        if (result.battleComplete) {
          // Battle over — compute ELO, send final result
          const finalResult = await this.battleService.finishBattle(data.battleId);
          this.server.to(data.roomCode).emit('battle:end', finalResult);
          const tenantIds = this.clearConnectedPlayersByRoom(data.roomCode);
          for (const tenantId of tenantIds) {
            await this.broadcastOnlineUsers(tenantId);
          }
        } else {
          // Send next question after 2-second delay
          setTimeout(() => {
            this.server.to(data.roomCode).emit('battle:question', {
              question: result.nextQuestion,
              roundNumber: data.roundNumber + 1,
              timeLimit: result.secondsPerRound,
            });
          }, 2000);
        }
      }
    } catch (error) {
      client.emit('battle:error', { message: error.message });
    }
  }
}
