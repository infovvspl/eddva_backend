import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches } from "class-validator";

export class SendPhoneOtpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: "phoneNumber must be in E.164 format (e.g. +919876543210)" })
  phoneNumber: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class VerifyPhoneOtpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: "phoneNumber must be in E.164 format" })
  phoneNumber: string;

  @IsString()
  @Length(6, 6, { message: "OTP must be exactly 6 digits" })
  otp: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class SendEmailOtpDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class VerifyEmailOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6, { message: "OTP must be exactly 6 digits" })
  otp: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class OtpRegisterDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: "phoneNumber must be in E.164 format" })
  phoneNumber: string;

  @IsString()
  @Length(8, 128, { message: "Password must be at least 8 characters" })
  password: string;

  @IsOptional()
  @IsString()
  role?: "institute_admin" | "student";
}

export class UpdatePendingContactDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: "phoneNumber must be in E.164 format" })
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
