import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { StudyPlanService } from './study-plan.service';
import { StudyPlanRangeQueryDto } from './dto/study-plan.dto';

@ApiTags('Study Plan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('study-plans')
export class StudyPlanController {
  constructor(private readonly studyPlanService: StudyPlanService) {}

  @Post('generate')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Generate a new study plan for the current student' })
  generate(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studyPlanService.generatePlan(user.id, tenantId, false);
  }

  @Post('regenerate')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Force regenerate the current student study plan' })
  regenerate(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studyPlanService.generatePlan(user.id, tenantId, true);
  }

  @Get('today')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: "Get today's study plan items in IST" })
  getToday(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studyPlanService.getToday(user.id, tenantId);
  }

  @Get()
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get plan items grouped by date' })
  getRange(
    @Query() query: StudyPlanRangeQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.getRange(user.id, tenantId, query);
  }

  @Patch('items/:itemId/complete')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Mark a plan item complete and award XP' })
  completeItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.completeItem(itemId, user.id, tenantId);
  }

  @Patch('items/:itemId/skip')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Skip a plan item and reschedule it' })
  skipItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.skipItem(itemId, user.id, tenantId);
  }

  @Get('next-action')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get the single most important next task for the student' })
  getNextAction(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studyPlanService.getNextAction(user.id, tenantId);
  }
}
