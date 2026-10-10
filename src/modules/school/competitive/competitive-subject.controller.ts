import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { CompetitiveFeatureGuard } from './competitive-feature.guard';
import { CompetitiveSubjectService } from './competitive-subject.service';
import { CreateCompetitiveSubjectDto, CreateGroundingLinkDto, UpdateCompetitiveSubjectDto } from './dto/competitive-subject.dto';

@Controller('school/competitive/subjects')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, CompetitiveFeatureGuard)
@SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
export class CompetitiveSubjectController {
  constructor(private readonly svc: CompetitiveSubjectService) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  list(@SchoolUser() user: any) {
    return this.svc.list(user);
  }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  create(@SchoolUser() user: any, @Body() dto: CreateCompetitiveSubjectDto) {
    return this.svc.create(user, dto);
  }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  update(@SchoolUser() user: any, @Param('id') id: string, @Body() dto: UpdateCompetitiveSubjectDto) {
    return this.svc.update(user, id, dto);
  }

  // Grounding links can be set by Institute Admin or the assigned Teacher —
  // a teacher is the one who actually knows which of their own ingested
  // textbook topics matches a given competitive topic.
  @Get(':id/grounding-links') listGroundingLinks(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.listGroundingLinks(user, id);
  }

  @Post(':id/grounding-links') createGroundingLink(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateGroundingLinkDto,
  ) {
    return this.svc.createGroundingLink(user, id, dto);
  }
}
