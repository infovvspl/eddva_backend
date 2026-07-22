import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../../database/entities/user.entity';

export interface JwtPayload {
  sub: string;      // user_id
  tenantId: string;
  role: string;
  batchIds?: string[]; // for teachers
  tokenVersion?: number;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User, 'coaching')
    private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  private userCache = new Map<string, { value: any; tokenVersion: number; expiresAt: number }>();
  private readonly cacheTtlMs = 15000; // 15 seconds

  async validate(payload: JwtPayload) {
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

