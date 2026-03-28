import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { PerformanceProfile } from '../../database/entities/analytics.entity';
import { StudentElo } from '../../database/entities/battle.entity';
import { Batch } from '../../database/entities/batch.entity';
import { Doubt, Lecture } from '../../database/entities/learning.entity';
import { TeacherProfile } from '../../database/entities/teacher.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
        signOptions: { expiresIn: cfg.get<string>('jwt.expiresIn') },
      }),
    }),
    TypeOrmModule.forFeature([User, Student, Tenant, PerformanceProfile, StudentElo, Batch, Lecture, Doubt, TeacherProfile]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
