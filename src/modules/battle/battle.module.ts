import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BattleController } from './battle.controller';
import { BattleService } from './battle.service';
import { BattleGateway } from './gateway/battle.gateway';
import {
  Battle,
  BattleParticipant,
  BattleAnswer,
  StudentElo,
} from '../../database/entities/battle.entity';
import { Question } from '../../database/entities/question.entity';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    AiBridgeModule,
    PresenceModule,
    TypeOrmModule.forFeature([Battle, BattleParticipant, BattleAnswer, StudentElo, Question]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [BattleController],
  providers: [BattleService, BattleGateway],
  exports: [BattleService],
})
export class BattleModule {}
