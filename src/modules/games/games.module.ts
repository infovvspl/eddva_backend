import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { Student } from '../../database/entities/student.entity';
import { Question } from '../../database/entities/question.entity';
import { Subject, Chapter } from '../../database/entities/subject.entity';
import { GameSession, QuizRushScore, Quest, QuestStage, StudentQuest, QuestReward, MathSprintScore, MemoryMatchScore, WordMasterScore } from '../../database/entities/game.entity';
import { NotificationModule } from '../notification/notification.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [
    GamificationModule,
    TypeOrmModule.forFeature([
      Student,
      Question,
      Subject,
      Chapter,
      GameSession,
      QuizRushScore,
      Quest,
      QuestStage,
      StudentQuest,
      QuestReward,
      MathSprintScore,
      MemoryMatchScore,
      WordMasterScore,
    ], 'coaching'),
    NotificationModule,
  ],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
