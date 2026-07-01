import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { Role } from '../../database/entities/role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role], 'coaching'),
  ],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
