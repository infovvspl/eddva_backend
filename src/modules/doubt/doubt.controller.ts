import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { DoubtService } from './doubt.service';
import {
  CreateDoubtDto,
  DoubtListQueryDto,
  MarkDoubtHelpfulDto,
  MarkDoubtReviewedDto,
  RateTeacherResponseDto,
  TeacherResponseDto,
} from './dto/doubt.dto';

@ApiTags('Doubt')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('doubts')
export class DoubtController {
  constructor(private readonly doubtService: DoubtService) {}

  @Post()
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Create a doubt and resolve it with AI' })
  createDoubt(
    @Body() dto: CreateDoubtDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.createDoubt(dto, user.id, tenantId);
  }

  @Get('queue')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Get escalated doubt queue for the current teacher' })
  getQueue(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.doubtService.getTeacherQueue(user.id, tenantId);
  }

  @Get()
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List doubts' })
  getDoubts(
    @Query() query: DoubtListQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.getDoubts(query, user, tenantId);
  }

  @Get(':id')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get doubt by id' })
  @ApiParam({ name: 'id', type: 'string' })
  getDoubtById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.getDoubtById(id, user, tenantId);
  }

  @Patch(':id/helpful')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Mark AI doubt response as helpful or escalate it' })
  markHelpful(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkDoubtHelpfulDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.markHelpful(id, dto, user.id, tenantId);
  }

  @Patch(':id/teacher-response')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Respond to an escalated doubt as teacher' })
  respondAsTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TeacherResponseDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.addTeacherResponse(id, dto, user.id, tenantId);
  }

  @Patch(':id/mark-reviewed')
  @Roles(UserRole.TEACHER)
  @ApiOperation({ summary: 'Mark AI answer as correct — no additional response needed' })
  markAsReviewed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkDoubtReviewedDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.markAsReviewed(id, dto, user.id, tenantId);
  }

  @Patch(':id/rate-teacher')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Student rates the teacher response as helpful or not' })
  rateTeacherResponse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateTeacherResponseDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.doubtService.rateTeacherResponse(id, dto, user.id, tenantId);
  }
}
