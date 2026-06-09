import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CareerService } from './career.service';
import { SubmitQuizDto } from './dto/career.dto';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

interface SchoolUserCtx {
  id: string;
  instituteId: string;
  role: string;
}

/**
 * Career Guidance — student-facing endpoints.
 * Full paths: /api/v1/school/career/*
 */
@Controller('school/career')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class CareerController {
  constructor(private readonly svc: CareerService) {}

  @Get('quiz/questions')
  @SchoolRoles('STUDENT')
  quizQuestions(@SchoolUser() user: SchoolUserCtx) {
    return this.svc.getQuizQuestions(user.id);
  }

  @Get('quiz/status')
  @SchoolRoles('STUDENT')
  quizStatus(@SchoolUser() user: SchoolUserCtx) {
    return this.svc.getQuizStatus(user.id);
  }

  @Post('quiz/submit')
  @SchoolRoles('STUDENT')
  submitQuiz(@SchoolUser() user: SchoolUserCtx, @Body() dto: SubmitQuizDto) {
    return this.svc.submitQuiz(user.id, user.instituteId, dto);
  }

  @Post('report/generate')
  @SchoolRoles('STUDENT')
  generateReport(@SchoolUser() user: SchoolUserCtx) {
    return this.svc.generateCareerReport(user.id, user.instituteId);
  }

  @Get('report')
  @SchoolRoles('STUDENT')
  report(@SchoolUser() user: SchoolUserCtx) {
    return this.svc.getCareerReport(user.id);
  }

  @Get('explore')
  @SchoolRoles('STUDENT')
  explore() {
    return this.svc.getCareerExplore();
  }

  @Get('explore/:careerId')
  @SchoolRoles('STUDENT')
  exploreOne(@Param('careerId') careerId: string) {
    return this.svc.getCareerDetail(careerId);
  }
}
