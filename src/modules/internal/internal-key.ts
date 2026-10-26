import { UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** Server-to-server calls (eddva_platform, ERP) authenticate with the shared INTERNAL_API_KEY. Fails closed. */
export function assertInternalKey(key?: string): void {
  const expected = process.env.INTERNAL_API_KEY ?? '';
  const a = Buffer.from(key ?? '');
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('Invalid internal key');
  }
}
