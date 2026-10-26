import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decodeProtectedHeader } from 'jose';
import * as jwt from 'jsonwebtoken';
import { User, UserStatus } from '../../../database/entities/user.entity';
import {
  PLATFORM_TOKEN_VERIFIER,
  PlatformTokenVerifier,
  platformVerifierFromEnv,
} from '../../../common/platform/platform-token.verifier';

export interface JwtPayload {
  sub: string;      // user_id
  tenantId: string;
  role: string;
  batchIds?: string[]; // for teachers
  tokenVersion?: number;
  source?: string;  // 'school' for a school-vertical token; absent/other for coaching
  iss?: string;     // the platform's issuer on platform tokens only
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly platformIssuer: string | null;

  constructor(
    private configService: ConfigService,
    @InjectRepository(User, 'coaching')
    private readonly userRepo: Repository<User>,
    @Optional() @Inject(PLATFORM_TOKEN_VERIFIER) platformVerifier?: PlatformTokenVerifier | null,
  ) {
    const platform = platformVerifier ?? platformVerifierFromEnv();
    const secret = configService.get<string>('jwt.secret');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: JwtStrategy.buildKeyProvider(secret, platform),
    });
    this.platformIssuer = platform?.issuer ?? null;
  }

  /**
   * Chooses the verification key from the token's own algorithm: RS256 is only ever checked against
   * the platform JWKS and everything else only against the shared secret, so neither kind of key can
   * be used to validate the other.
   */
  private static buildKeyProvider(secret: string | undefined, platform: PlatformTokenVerifier | null) {
    const reject = () => new UnauthorizedException('Invalid or expired token');
    return (_req: unknown, rawJwtToken: string, done: (err: any, key?: string) => void) => {
      let alg: string | undefined;
      try {
        alg = decodeProtectedHeader(rawJwtToken).alg;
      } catch {
        return done(reject());
      }

      if (alg === 'RS256') {
        if (!platform) return done(reject());
        platform.verify(rawJwtToken).then(
          ({ publicKeyPem }) => done(null, publicKeyPem),
          () => done(reject()),
        );
        return;
      }

      // A shared-secret token must not be able to pose as a platform token.
      if (platform && (jwt.decode(rawJwtToken) as jwt.JwtPayload | null)?.iss === platform.issuer) {
        return done(reject());
      }
      return done(null, secret);
    };
  }

  /**
   * Platform tokens resolve to a coaching user only through users.platform_user_id (set by the
   * internal link endpoint). Role and tenant come from the DB row, never from token claims, and
   * tokenVersion does not apply: platform sessions end through the platform's own refresh tokens.
   */
  private async validatePlatform(payload: JwtPayload) {
    const user = await this.userRepo.findOne({ where: { platformUserId: payload.sub }, relations: ['tenant'] });
    if (!user) throw new UnauthorizedException('No coaching account is linked to this platform user');
    if (user.status === UserStatus.SUSPENDED) throw new UnauthorizedException('Account suspended');
    return {
      id: user.id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
      tenant: user.tenant,
      batchIds: [] as string[],
    };
  }

  private userCache = new Map<string, { value: any; tokenVersion: number; expiresAt: number }>();
  private readonly cacheTtlMs = 15000; // 15 seconds

  async validate(payload: JwtPayload) {
    if (this.platformIssuer !== null && payload.iss === this.platformIssuer) {
      return this.validatePlatform(payload);
    }

    // A school-vertical token (school-auth.service.ts's signSchoolToken) shares
    // this same JWT secret and can carry the identical 'super_admin' role
    // string, but its `sub` is a row in the SCHOOL database, not this one —
    // letting it through here would authenticate it against a coaching user
    // that doesn't actually correspond to the caller. Reject it outright
    // rather than let the two verticals' sessions cross.
    if (payload.source === 'school') {
      throw new UnauthorizedException('This session belongs to the school vertical, not coaching.');
    }

    const userId = payload.sub;
    const payloadTokenVersion = payload.tokenVersion ?? 0;
    const now = Date.now();
    const cached = this.userCache.get(userId);

    if (cached && cached.expiresAt > now) {
      if (cached.tokenVersion !== payloadTokenVersion) {
        throw new UnauthorizedException('Session terminated');
      }
      return {
        ...cached.value,
        batchIds: payload.batchIds || [],
      };
    }

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['tenant'],
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended');
    }

    const userTokenVersion = user.tokenVersion ?? 0;
    if (userTokenVersion !== payloadTokenVersion) {
      throw new UnauthorizedException('Session terminated');
    }

    const userData = {
      id: user.id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
      tenant: user.tenant,
    };

    this.userCache.set(userId, { value: userData, tokenVersion: userTokenVersion, expiresAt: now + this.cacheTtlMs });

    return {
      ...userData,
      batchIds: payload.batchIds || [],
    };
  }
}

