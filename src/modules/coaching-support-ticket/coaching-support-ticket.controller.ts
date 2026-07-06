import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { CoachingSupportTicketService } from './coaching-support-ticket.service';
import { CreateCoachingSupportTicketDto, TicketPriority } from './dto/create-coaching-support-ticket.dto';
import { TicketStatus } from './dto/update-coaching-support-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';
import { QueryCoachingSupportTicketDto } from './dto/query-coaching-support-ticket.dto';

@ApiTags('Coaching Support Tickets')
@ApiBearerAuth()
@Controller('coaching/support-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.INSTITUTE_ADMIN,
  UserRole.TEACHER,
  UserRole.STUDENT,
  UserRole.PARENT,
)
export class CoachingSupportTicketController {
  constructor(private readonly service: CoachingSupportTicketService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new coaching support ticket' })
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateCoachingSupportTicketDto,
  ) {
    return this.service.createTicket(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List coaching support tickets based on scope and role' })
  findAll(
    @CurrentUser() user: any,
    @Query() query: QueryCoachingSupportTicketDto,
  ) {
    return this.service.listTickets(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific coaching support ticket' })
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getTicket(user, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'List conversation messages for a coaching support ticket' })
  findMessages(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.listMessages(user, id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Add a reply message to a coaching support ticket' })
  createMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateTicketMessageDto,
  ) {
    return this.service.createMessage(user, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update ticket status' })
  updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('status') status: TicketStatus,
  ) {
    return this.service.updateStatus(user, id, status);
  }

  @Patch(':id/priority')
  @ApiOperation({ summary: 'Update ticket priority' })
  updatePriority(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('priority') priority: TicketPriority,
  ) {
    return this.service.updatePriority(user, id, priority);
  }

  @Post(':id/escalate')
  @ApiOperation({ summary: 'Escalate a ticket to Super Admin' })
  escalate(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: EscalateTicketDto,
  ) {
    return this.service.escalateTicket(user, id, dto);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a resolved support ticket' })
  close(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.closeTicket(user, id);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a closed or resolved support ticket' })
  reopen(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.reopenTicket(user, id);
  }
}
