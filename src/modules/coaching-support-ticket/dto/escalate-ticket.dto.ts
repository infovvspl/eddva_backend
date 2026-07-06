import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class EscalateTicketDto {
  @ApiPropertyOptional({ description: 'Reason or notes for escalating to Super Admin' })
  @IsString()
  @IsOptional()
  reason?: string;
}
