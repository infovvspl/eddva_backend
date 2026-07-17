import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolStudentService } from './school-student.service';

@Controller('school/users')
@UseGuards(SchoolJwtGuard)
export class SchoolUserController {
  constructor(private readonly studentSvc: SchoolStudentService) {}

  @Post('device-token')
  registerDeviceToken(@SchoolUser() user: any, @Body() body: any) {
    return this.studentSvc.registerDeviceToken(user, body);
  }
}
