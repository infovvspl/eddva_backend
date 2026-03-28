import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([Battle, BattleParticipant, BattleAnswer, StudentElo, Question]),
  ],
  controllers: [BattleController],
  providers: [BattleService, BattleGateway],
  exports: [BattleService],
})
export class BattleModule {}
