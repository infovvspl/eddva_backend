import { SetMetadata } from '@nestjs/common';

export const SCHOOL_FEATURE_KEY = 'school_feature';

export interface SchoolFeatureRequirement {
  type: 'module' | 'ai';
  key: string;
}

export const SchoolFeature = (type: 'module' | 'ai', key: string) =>
  SetMetadata(SCHOOL_FEATURE_KEY, { type, key } as SchoolFeatureRequirement);
