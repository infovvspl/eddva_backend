import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';

@Injectable()
export class EnrollmentStatusService {
  constructor(
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
  ) {}

  async hasActiveEnrollment(studentId: string): Promise<boolean> {
    const count = await this.enrollmentRepo.count({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
    });
    return count > 0;
  }
}
