import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SchoolAuthController } from './school-auth.controller';
import { SchoolAuthService } from './school-auth.service';
import { SchoolDatabaseService } from './school-database.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
        signOptions: { expiresIn: cfg.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  controllers: [SchoolAuthController],
  providers: [SchoolDatabaseService, SchoolAuthService],
  exports: [SchoolDatabaseService, SchoolAuthService],
})
export class SchoolAuthModule {}
