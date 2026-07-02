import { Global, Module } from '@nestjs/common';
import { TenantAiFeatureService } from './tenant-ai-feature.service';

@Global()
@Module({
  providers: [TenantAiFeatureService],
  exports: [TenantAiFeatureService],
})
export class TenantAiFeatureModule {}
