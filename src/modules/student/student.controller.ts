import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StudentService } from './student.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Student')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('students')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Get('dashboard')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Student dashboard — rank, plan, weak topics, streak' })
  getDashboard(@CurrentUser('id') userId: string, @TenantId() tenantId: string) {
    return this.studentService.getDashboard(userId, tenantId);
  }

  @Get('weak-topics')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get weak topics with severity and chapter context' })
  getWeakTopics(@CurrentUser('id') userId: string) {
    return this.studentService.getWeakTopics(userId);
  }
}
