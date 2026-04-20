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
  private onlineUsers = new Map<string, { socketId: string; studentId: string; tenantId: string }>();
  private socketToStudent = new Map<string, string>();
  private pendingChallenges = new Map<
    string,
    {
      challengeId: string;
      fromStudentId: string;
      toStudentId: string;
      tenantId: string;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(private readonly battleService: BattleService) {}

  afterInit(server: Server) {
    this.logger.log('Battle WebSocket Gateway initialised');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const disconnectedStudentId = this.socketToStudent.get(client.id);
    if (disconnectedStudentId) {
      const tenantId = this.onlineUsers.get(disconnectedStudentId)?.tenantId;
      this.onlineUsers.delete(disconnectedStudentId);
      this.socketToStudent.delete(client.id);

      // Cancel challenge requests where disconnected user is sender/receiver
      for (const [challengeId, req] of this.pendingChallenges.entries()) {
        if (req.fromStudentId === disconnectedStudentId || req.toStudentId === disconnectedStudentId) {
          clearTimeout(req.timer);
          this.pendingChallenges.delete(challengeId);
        }
      }
      if (tenantId) await this.broadcastOnlineUsers(tenantId);
    }

    const player = this.connectedPlayers.get(client.id);
    if (player) {
      this.logger.debug(`Player ${player.studentId} disconnected from room ${player.roomCode}`);
      // Notify opponent
      client.to(player.roomCode).emit('battle:opponent_left', {
        message: 'Your opponent disconnected',
      });
      this.connectedPlayers.delete(client.id);
    }
  }

  @SubscribeMessage('lobby:join')
  handleLobbyJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { studentId: string; tenantId: string },
  ) {
    if (!data?.studentId || !data?.tenantId) {
      client.emit('battle:error', { message: 'Missing studentId or tenantId for lobby join' });
      return;
    }

    this.onlineUsers.set(data.studentId, {
      socketId: client.id,
      studentId: data.studentId,
      tenantId: data.tenantId,
    });
    this.socketToStudent.set(client.id, data.studentId);
    void this.broadcastOnlineUsers(data.tenantId);
  }

  @SubscribeMessage('battle:challenge')
  handleChallengeRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetStudentId: string; fromStudentId: string; tenantId: string },
  ) {
    const { targetStudentId, fromStudentId, tenantId } = data ?? {};
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
    if (target.tenantId !== tenantId) {
      client.emit('battle:challenge_error', { message: 'Target student is in a different tenant lobby' });
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
        message: 'No response in 10 seconds. Starting bot battle.',
      });
    }, 10_000);

    this.pendingChallenges.set(challengeId, {
      challengeId,
      fromStudentId,
      toStudentId: targetStudentId,
      tenantId,
      timer: timeout,
    });

    this.server.to(target.socketId).emit('battle:incoming_request', {
      challengeId,
      fromStudentId,
      expiresInSeconds: 10,
    });

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
      this.server.to(sender.socketId).emit('battle:challenge_rejected', {
        challengeId: data.challengeId,
        byStudentId: pending.toStudentId,
      });
      await this.broadcastOnlineUsers(pending.tenantId);
      return;
    }

    try {
      const room = await this.battleService.createPrivateChallengeRoom(
        pending.fromStudentId,
        pending.toStudentId,
        pending.tenantId,
      );

      // Put both clients in the private socket room and start immediately.
      client.join(room.roomCode);
      this.server.sockets.sockets.get(sender.socketId)?.join(room.roomCode);

      this.connectedPlayers.set(client.id, { studentId: pending.toStudentId, roomCode: room.roomCode });
      this.connectedPlayers.set(sender.socketId, { studentId: pending.fromStudentId, roomCode: room.roomCode });

      await this.battleService.startBattle(room.battleId);
      const questions = await this.battleService.getBattleQuestions(room.battleId);

      this.server.to(room.roomCode).emit('battle:start', {
        battle: {
          id: room.battleId,
          roomCode: room.roomCode,
          totalRounds: room.totalRounds ?? 10,
          secondsPerRound: room.secondsPerRound ?? 45,
        },
        room,
        firstQuestion: questions[0],
        totalRounds: room.totalRounds ?? 10,
        timePerRound: room.secondsPerRound ?? 45,
      });

      this.server.to(sender.socketId).emit('battle:challenge_accepted', {
        challengeId: data.challengeId,
        room,
      });
      client.emit('battle:challenge_accepted', {
        challengeId: data.challengeId,
        room,
      });
      await this.broadcastOnlineUsers(pending.tenantId);
    } catch (error) {
      this.server.to(sender.socketId).emit('battle:challenge_error', { message: error.message });
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

      // Notify all in room about new participant
      const participants = await this.battleService.getRoomParticipants(roomCode);
      this.server.to(roomCode).emit('battle:player_joined', { participants });

      // Start battle when room is full
      if (participants.length >= battle.maxParticipants) {
        // Mark battle as ACTIVE in the database so REST polling detects it
        await this.battleService.startBattle(battle.id);
        const questions = await this.battleService.getBattleQuestions(battle.id);
        this.server.to(roomCode).emit('battle:start', {
          battle,
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
    const studentIds = tenantUsers.map(u => u.studentId);
    const profiles = await this.battleService.getLobbyUsersByStudentIds(studentIds, tenantId);

    const waitingStudentIds = new Set<string>();
    for (const req of this.pendingChallenges.values()) {
      if (req.tenantId !== tenantId) continue;
      waitingStudentIds.add(req.fromStudentId);
      waitingStudentIds.add(req.toStudentId);
    }
    const inBattleStudentIds = new Set(Array.from(this.connectedPlayers.values()).map(v => v.studentId));

    const users = profiles.map(p => ({
      studentId: p.studentId,
      socketId: this.onlineUsers.get(p.studentId)?.socketId ?? '',
      name: p.name,
      avatarUrl: p.avatarUrl,
      eloRating: p.eloRating,
      tier: p.tier,
      status: inBattleStudentIds.has(p.studentId)
        ? 'in_battle'
        : waitingStudentIds.has(p.studentId)
          ? 'waiting'
          : 'online',
    }));

    for (const u of tenantUsers) {
      this.server.to(u.socketId).emit('lobby:online_users', { users });
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
