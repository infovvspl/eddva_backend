import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiBridgeService } from './ai-bridge.service';
import { AiBridgeController } from './ai-bridge.controller';
import { AiFeatureGuard } from '../../common/guards/ai-feature.guard';
import { Tenant } from '../../database/entities/tenant.entity';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        timeout: cfg.get<number>('ai.timeoutMs'),
        maxRedirects: 3,
      }),
    }),
    TypeOrmModule.forFeature([Tenant], 'coaching'),
  ],
  controllers: [AiBridgeController],
  providers: [AiBridgeService, AiFeatureGuard],
  exports: [AiBridgeService],
})
export class AiBridgeModule {}
