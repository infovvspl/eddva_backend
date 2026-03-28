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

  constructor(private readonly battleService: BattleService) {}

  afterInit(server: Server) {
    this.logger.log('Battle WebSocket Gateway initialised');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
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

      // Notify all in room about new participant
      const participants = await this.battleService.getRoomParticipants(roomCode);
      this.server.to(roomCode).emit('battle:player_joined', { participants });

      // Start battle when room is full
      if (participants.length >= battle.maxParticipants) {
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
        } else {
          // Send next question after 2-second delay
          setTimeout(() => {
            this.server.to(data.roomCode).emit('battle:question', {
              question: result.nextQuestion,
              roundNumber: data.roundNumber + 1,
              timeLimit: data.responseTimeMs,
            });
          }, 2000);
        }
      }
    } catch (error) {
      client.emit('battle:error', { message: error.message });
    }
  }
}
