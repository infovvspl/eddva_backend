import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsNumber,
    IsBoolean,
    IsUUID,
    IsArray,
    Min,
    Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateTopicDto {
    @ApiProperty({ example: 'uuid-of-chapter' })
    @IsUUID()
    @IsNotEmpty()
    chapterId: string;

    @ApiProperty({ example: 'Carnot Engine' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    sortOrder?: number;

    @ApiPropertyOptional({ example: 70, description: 'Minimum accuracy % to unlock next topic' })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    gatePassPercentage?: number;

    @ApiPropertyOptional({ example: 60 })
    @IsOptional()
    @IsNumber()
    @Min(1)
    estimatedStudyMinutes?: number;

    @ApiPropertyOptional({ type: [String], example: ['uuid-1', 'uuid-2'] })
    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    prerequisiteTopicIds?: string[];
}

export class UpdateTopicDto extends PartialType(CreateTopicDto) {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class TopicQueryDto {
    @ApiProperty({ example: 'uuid-of-chapter' })
    @IsUUID()
    @IsNotEmpty()
    chapterId: string;
}
