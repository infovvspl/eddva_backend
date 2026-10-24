import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Guards the inbound biometric-device webhook. The caller is a physical
 * device, not a logged-in school user, so this checks a shared device API
 * key header instead of SchoolJwtGuard. Fails closed if the key isn't
 * configured, same convention as `requireModuleSecret` in the ERP backend —
 * a missing env value must never silently accept everything.
 */
@Injectable()
export class BiometricDeviceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.BIOMETRIC_DEVICE_API_KEY;
    if (!expected) {
      throw new UnauthorizedException('Biometric device check-in is not configured on this server.');
    }
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-device-api-key'];
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing device API key.');
    }
    return true;
  }
}
