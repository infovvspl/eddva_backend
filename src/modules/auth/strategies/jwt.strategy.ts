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

  private userCache = new Map<string, { value: any; expiresAt: number }>();
  private readonly cacheTtlMs = 15000; // 15 seconds

  async validate(payload: JwtPayload) {
    const userId = payload.sub;
    const now = Date.now();
    const cached = this.userCache.get(userId);

    if (cached && cached.expiresAt > now) {
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

    const userData = {
      id: user.id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
      tenant: user.tenant,
    };

    this.userCache.set(userId, { value: userData, expiresAt: now + this.cacheTtlMs });

    return {
      ...userData,
      batchIds: payload.batchIds || [],
    };
  }
}

