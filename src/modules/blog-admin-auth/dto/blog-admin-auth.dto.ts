import { IsString, MaxLength, MinLength } from 'class-validator';

export class BlogAdminLoginDto {
  @IsString()
  @MaxLength(100)
  username: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

export class BlogAdminChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword: string;
}
