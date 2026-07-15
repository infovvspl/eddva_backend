// ── School Notification Templates (English only — Phase 2) ─────────────────
// Each template has a title and body with {placeholder} tokens.
// Substitution uses simple split/join (no regex needed).

export enum SchoolFcmNotificationType {
  // Greetings
  GOOD_MORNING = 'GOOD_MORNING',
  GOOD_AFTERNOON = 'GOOD_AFTERNOON',
  GOOD_NIGHT = 'GOOD_NIGHT',
  
  // Student/Teacher
  CLASS_REMINDER = 'CLASS_REMINDER',
  TEACHER_CLASS_REMINDER = 'TEACHER_CLASS_REMINDER',
  
  // Teacher
  ASSIGNMENT_SUBMISSION = 'ASSIGNMENT_SUBMISSION',
  ATTENDANCE_REMINDER = 'ATTENDANCE_REMINDER',
  MEETING_SCHEDULED = 'MEETING_SCHEDULED',
  
  // Parent
  CHILD_ABSENT = 'CHILD_ABSENT',
  CHILD_LATE = 'CHILD_LATE',
  RESULT_PUBLISHED = 'RESULT_PUBLISHED',
  LOW_PERFORMANCE_ALERT = 'LOW_PERFORMANCE_ALERT',
  FEE_REMINDER = 'FEE_REMINDER',
  
  // Admin / General
  NOTICE_PUBLISHED = 'NOTICE_PUBLISHED',
  NEW_COMPLAINT = 'NEW_COMPLAINT',
  STAFF_ATTENDANCE_DIGEST = 'STAFF_ATTENDANCE_DIGEST',
  FEE_COLLECTION_SUMMARY = 'FEE_COLLECTION_SUMMARY',
  
  // Super Admin
  NEW_INSTITUTE_SIGNUP = 'NEW_INSTITUTE_SIGNUP'
}

export interface NotificationTemplate {
  title: string;
  body: string;
}

export const SCHOOL_NOTIFICATION_TEMPLATES: Record<SchoolFcmNotificationType, NotificationTemplate> = {
  [SchoolFcmNotificationType.GOOD_MORNING]: {
    title: 'Good Morning, {name}! ☀️',
    body: 'Rise and shine! A wonderful day of learning awaits you.',
  },
  [SchoolFcmNotificationType.GOOD_AFTERNOON]: {
    title: 'Good Afternoon, {name}! 🌤️',
    body: 'Hope your day is going great. Keep up the fantastic work!',
  },
  [SchoolFcmNotificationType.GOOD_NIGHT]: {
    title: 'Good Night, {name}! 🌙',
    body: 'Rest well tonight and recharge for another exciting day of learning tomorrow.',
  },
  [SchoolFcmNotificationType.CLASS_REMINDER]: {
    title: '{subject} class starting soon ⏰',
    body: 'Hey {name}, your {subject} class starts at {time}. Get ready!',
  },
  [SchoolFcmNotificationType.TEACHER_CLASS_REMINDER]: {
    title: 'Your {subject} class is starting soon ⏰',
    body: 'Hey {name}, your {subject} class for {sectionName} starts at {time}.',
  },
  [SchoolFcmNotificationType.ASSIGNMENT_SUBMISSION]: {
    title: 'New submission for {title} 📝',
    body: 'Hey {name}, {studentName} has submitted their work for {title}.',
  },
  [SchoolFcmNotificationType.ATTENDANCE_REMINDER]: {
    title: 'Mark attendance reminder 📋',
    body: 'Hey {name}, please remember to mark attendance for {sectionName} today.',
  },
  [SchoolFcmNotificationType.MEETING_SCHEDULED]: {
    title: 'New meeting scheduled 📅',
    body: 'Hey {name}, a meeting "{title}" has been scheduled for {time}.',
  },
  [SchoolFcmNotificationType.CHILD_ABSENT]: {
    title: 'Child marked Absent ❌',
    body: 'Dear parent, {studentName} was marked ABSENT today ({date}).',
  },
  [SchoolFcmNotificationType.CHILD_LATE]: {
    title: 'Child marked Late ⚠️',
    body: 'Dear parent, {studentName} was marked LATE today ({date}).',
  },
  [SchoolFcmNotificationType.RESULT_PUBLISHED]: {
    title: 'Exam results published 📊',
    body: 'Dear parent, the results for {studentName}\'s {examName} exam have been published.',
  },
  [SchoolFcmNotificationType.LOW_PERFORMANCE_ALERT]: {
    title: 'Academic performance alert ⚠️',
    body: 'Dear parent, {studentName}\'s recent average score is {average}% (below target). Please review.',
  },
  [SchoolFcmNotificationType.FEE_REMINDER]: {
    title: 'Fee payment reminder 💰',
    body: 'Dear parent, the fee "{feeName}" for {studentName} is due/overdue. Amount: {amount}.',
  },
  [SchoolFcmNotificationType.NOTICE_PUBLISHED]: {
    title: 'New announcement: {title} 📢',
    body: '{body}',
  },
  [SchoolFcmNotificationType.NEW_COMPLAINT]: {
    title: 'New grievance/complaint registered ⚠️',
    body: 'A new {category} complaint has been submitted by {submitterName}.',
  },
  [SchoolFcmNotificationType.STAFF_ATTENDANCE_DIGEST]: {
    title: 'Daily staff attendance digest 📋',
    body: '{absentCount} teacher(s) marked absent, and {lateCount} marked late today.',
  },
  [SchoolFcmNotificationType.FEE_COLLECTION_SUMMARY]: {
    title: 'Weekly fee collection summary 📈',
    body: 'Total collected this week: {totalAmount}. Pending: {pendingAmount}.',
  },
  [SchoolFcmNotificationType.NEW_INSTITUTE_SIGNUP]: {
    title: 'New school signup registered 🚀',
    body: 'School "{name}" has signed up under plan "{plan}".',
  },
};

/**
 * Simple placeholder substitution — splits on `{key}` and joins with the
 * corresponding value.
 */
export function fillTemplate(
  template: NotificationTemplate,
  variables: Record<string, string>,
): { title: string; body: string } {
  let { title, body } = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    title = title.split(placeholder).join(value);
    body = body.split(placeholder).join(value);
  }
  return { title, body };
}
