import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'school_is_public';
export const SchoolPublic = () => SetMetadata(IS_PUBLIC_KEY, true);
