import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchoolTeacherService } from './src/modules/school/teacher/school-teacher.service';

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const teacherService = app.get(SchoolTeacherService);

  const payload = {
    name: "Anil Mishra",
    email: "anil.mishra@colvin.com",
    phone: "9876543210",
    profileImage: null,
    employeeId: "EMP2026003",
    bloodGroup: null,
    maritalStatus: null,
    department: null,
    joiningDate: null,
    qualifications: null,
    educationDetails: [],
    experienceDetails: [],
    subjectIds: [],
    assignments: [],
    dob: null,
    gender: null,
    nationalId: null,
    nationality: null,
    religion: null,
    role: null, // "designation" in teachers table
    employmentType: null,
    salary: null,
    experience: null,
    qualification: null,
    degree: null,
    specialization: null,
    institute: null,
    passingYear: null,
    languages: null,
    achievements: null,
    shift: null,
    weekdays: [],
    officeHoursStart: null,
    officeHoursEnd: null,
    maxHoursPerWeek: null,
    currentAddress: null,
    permanentAddress: null,
    city: null,
    state: null,
    country: null,
    pinCode: null,
    emergencyContact: null,
    guardianContact: null,
    allergies: null,
    medicalConditions: null,
    disability: null,
    emergencyDoctor: null,
    docs: {}
  };

  const adminUser = {
    role: 'SUPER_ADMIN',
    instituteId: 'eadac06f-cebd-4d70-9a6e-52959e541896'
  };

  try {
    console.log("Calling update with full payload...");
    const res = await teacherService.update(adminUser, 'e2840eda-64d3-4a41-ab01-48c76a610ee9', payload);
    console.log("Update success!", res);
  } catch (err) {
    console.error("Update failed with error:", err);
  }

  await app.close();
}

test();
