import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { v4 as uuidv4 } from 'uuid';

@Controller('school/assignments')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAssignmentController {
  constructor(private readonly svc: SchoolAssignmentService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  
  @Post() 
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + uuidv4();
        cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
      }
    })
  }))
  create(@SchoolUser() user: any, @Body() body: any, @UploadedFile() file: Express.Multer.File) { 
    return this.svc.create(user, body, file); 
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
