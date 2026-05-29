import { SetMetadata } from '@nestjs/common';
import { AiFeatureKey } from '../../database/entities/tenant.entity';
import { AI_FEATURE_KEY } from '../guards/ai-feature.guard';

export const AiFeature = (feature: AiFeatureKey) => SetMetadata(AI_FEATURE_KEY, feature);
