import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateMindmapDto {
  @IsString()
  @IsNotEmpty()
  topic: string;
}
