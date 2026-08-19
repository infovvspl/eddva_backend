import {
  Body,
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

import { Public } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { LeadsService } from './leads.service';
import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './dto/lead.dto';

/**
 * Public "Request a Demo" capture. The submit endpoint is unauthenticated (it is
 * called from the marketing site); listing/updating leads is super-admin only.
 * The global ThrottlerGuard rate-limits the public submit.
 */
@ApiTags('Leads')
@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  // ── Public: submit a demo request ──────────────────────────────────────────
  @Post('tenants/public/leads')
  @Public()
  @ApiOperation({ summary: 'Submit a demo request / lead from the marketing site' })
  async submit(@Body() dto: CreateLeadDto) {
    const lead = await this.leads.create(dto);
    return { success: true, id: lead.id };
  }

  // ── Super-admin: manage leads ──────────────────────────────────────────────
  @Get('admin/leads')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List demo-request leads (super-admin)' })
  async list(@Query() query: ListLeadsQueryDto) {
    return this.leads.list(query);
  }

  @Patch('admin/leads/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a lead status / notes (super-admin)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }
}
