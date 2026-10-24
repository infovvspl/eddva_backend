import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SchoolTeacherAttendanceService } from './school-teacher-attendance.service';
import { BiometricDeviceGuard } from '../guards/biometric-device.guard';

/**
 * Inbound push from a biometric device at the school gate. Separate
 * controller (not a route on SchoolTeacherAttendanceController) because it
 * must skip SchoolJwtGuard entirely — the caller is a device, not a logged-in
 * user — and NestJS combines class-level @UseGuards rather than letting a
 * method override them.
 *
 * Payload is a simple internal JSON shape, not any specific vendor's wire
 * format — no device vendor is chosen yet, so translating a real one is a
 * follow-up once a device is picked.
 */
@Controller('school/teacher-attendance/biometric-webhook')
@UseGuards(BiometricDeviceGuard)
export class SchoolBiometricWebhookController {
  constructor(private readonly svc: SchoolTeacherAttendanceService) {}

  @Post()
  checkIn(@Body() body: {
    instituteId: string;
    employeeId: string;
    eventType: 'IN' | 'OUT';
    deviceId?: string;
    timestamp?: string;
  }) {
    return this.svc.biometricCheckIn(body);
  }
}
