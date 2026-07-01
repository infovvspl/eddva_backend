import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { TenantId } from '../../common/decorators/auth.decorator';

@ApiTags('Custom Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: 'Create a custom staff role' })
  create(@Body() dto: CreateRoleDto, @TenantId() tenantId: string) {
    return this.roleService.create(dto, tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'List all custom staff roles in this institute' })
  findAll(@TenantId() tenantId: string) {
    return this.roleService.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a custom staff role' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.roleService.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update permissions/details of a custom staff role' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @TenantId() tenantId: string,
  ) {
    return this.roleService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom staff role' })
  remove(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.roleService.remove(id, tenantId);
  }
}
