import { Module } from '@nestjs/common';
import { UploadModule } from '../../upload/upload.module';
import { SchoolClassService } from './school-class.service';
import { SchoolClassController } from './school-class.controller';

@Module({
  imports: [UploadModule],
  controllers: [SchoolClassController],
  providers: [SchoolClassService],
})
export class SchoolClassModule {}
