import { Global, Module } from '@nestjs/common';
import { FeatureFlagGuard } from './feature-flag.guard';

@Global()
@Module({
  providers: [FeatureFlagGuard],
  exports: [FeatureFlagGuard],
})
export class FeatureFlagModule {}
