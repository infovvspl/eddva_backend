import { Module } from '@nestjs/common';
import { EmergencySosController } from './emergency-sos.controller';
import { EmergencySosService } from './emergency-sos.service';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [EmergencySosController],
  providers: [EmergencySosService],
})
export class EmergencySosModule {}
