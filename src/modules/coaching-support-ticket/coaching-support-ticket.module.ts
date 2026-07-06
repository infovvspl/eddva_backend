import { Module } from '@nestjs/common';
import { CoachingSupportTicketService } from './coaching-support-ticket.service';
import { CoachingSupportTicketController } from './coaching-support-ticket.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [CoachingSupportTicketController],
  providers: [CoachingSupportTicketService],
  exports: [CoachingSupportTicketService],
})
export class CoachingSupportTicketModule {}
