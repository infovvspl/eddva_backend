import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiBridgeService } from './ai-bridge.service';
import { AiBridgeController } from './ai-bridge.controller';

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
  ],
  controllers: [AiBridgeController],
  providers: [AiBridgeService],
  exports: [AiBridgeService],
})
export class AiBridgeModule {}
