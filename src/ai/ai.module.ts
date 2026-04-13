import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLMService } from './llm.service';
import { RagService } from './rag.service';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';

@Module({
  imports: [ConfigModule],
  controllers: [AIController],
  providers: [LLMService, RagService, AIService],
  exports: [LLMService, RagService, AIService],
})
export class AIModule {}
