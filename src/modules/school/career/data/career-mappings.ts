import { HollandLetter } from './quiz-questions';

export interface CareerPath {
  id: string;
  title: string;
  stream: 'science' | 'commerce' | 'arts' | 'any';
  hollandMatch: HollandLetter[];
  requiredSubjects: Record<string, number>;
  exams: string[];
  topColleges: string[];
  salaryRange: string;
  description: string;
  gradeRelevance: number[];
}

export const CAREER_PATHS: CareerPath[] = [
  {
    id: 'medicine',
    title: 'Medicine (MBBS/BDS)',
    stream: 'science',
    hollandMatch: ['I', 'S'],
    requiredSubjects: { biology: 80, chemistry: 75, physics: 60 },
    exams: ['NEET UG'],
    topColleges: ['AIIMS Delhi', 'CMC Vellore', 'JIPMER'],
    salaryRange: '₹8–50 LPA',
    description: 'Diagnose and treat patients across specialisations',
    gradeRelevance: [9, 10, 11, 12],
  },
  {
    id: 'engineering',
    title: 'Engineering (B.Tech)',
    stream: 'science',
    hollandMatch: ['R', 'I'],
    requiredSubjects: { mathematics: 80, physics: 75 },
    exams: ['JEE Mains', 'JEE Advanced', 'BITSAT'],
    topColleges: ['IIT Bombay', 'IIT Delhi', 'NIT Trichy'],
    salaryRange: '₹6–40 LPA',
    description: 'Design and build technology solutions',
    gradeRelevance: [9, 10, 11, 12],
  },
  {
    id: 'data_science',
    title: 'Data Science / AI',
    stream: 'science',
    hollandMatch: ['I', 'C'],
    requiredSubjects: { mathematics: 85 },
    exams: ['JEE Mains', 'CUET'],
    topColleges: ['IITs', 'IIITs', 'BITS Pilani'],
    salaryRange: '₹10–60 LPA',
    description: 'Analyse data and build AI/ML solutions',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'architecture',
    title: 'Architecture',
    stream: 'science',
    hollandMatch: ['A', 'R'],
    requiredSubjects: { mathematics: 70 },
    exams: ['NATA', 'JEE Paper 2'],
    topColleges: ['SPA Delhi', 'CEPT Ahmedabad'],
    salaryRange: '₹5–30 LPA',
    description: 'Design buildings and urban spaces',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'law',
    title: 'Law (LLB)',
    stream: 'any',
    hollandMatch: ['E', 'S'],
    requiredSubjects: { english: 75 },
    exams: ['CLAT', 'AILET', 'LSAT India'],
    topColleges: ['NLSIU Bangalore', 'NLU Delhi', 'NALSAR'],
    salaryRange: '₹6–50 LPA',
    description: 'Represent clients and interpret law',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'chartered_accountancy',
    title: 'Chartered Accountancy (CA)',
    stream: 'commerce',
    hollandMatch: ['C', 'E'],
    requiredSubjects: { mathematics: 65, accountancy: 75 },
    exams: ['CA Foundation', 'CA Intermediate', 'CA Final'],
    topColleges: ['ICAI (self-study)'],
    salaryRange: '₹8–40 LPA',
    description: 'Manage finances, audits, and tax for organisations',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'journalism',
    title: 'Journalism & Media',
    stream: 'arts',
    hollandMatch: ['A', 'S'],
    requiredSubjects: { english: 80 },
    exams: ['IIMC', 'XIC', 'ACJ'],
    topColleges: ['IIMC Delhi', 'ACJ Chennai', 'Symbiosis'],
    salaryRange: '₹4–25 LPA',
    description: 'Report news and create media content',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'design',
    title: 'Design (UX/Fashion/Interior)',
    stream: 'arts',
    hollandMatch: ['A', 'R'],
    requiredSubjects: {},
    exams: ['NID', 'NIFT', 'CEED'],
    topColleges: ['NID Ahmedabad', 'NIFT Delhi', 'IDC IIT Bombay'],
    salaryRange: '₹5–35 LPA',
    description: 'Create visual and product experiences',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'psychology',
    title: 'Psychology / Counselling',
    stream: 'arts',
    hollandMatch: ['S', 'I'],
    requiredSubjects: { english: 70 },
    exams: ['CUET', 'university entrance'],
    topColleges: ['Delhi University', 'Christ University', 'Tata Institute'],
    salaryRange: '₹4–20 LPA',
    description: 'Understand and support human behaviour and mental health',
    gradeRelevance: [10, 11, 12],
  },
  {
    id: 'entrepreneurship',
    title: 'Entrepreneurship / Business',
    stream: 'any',
    hollandMatch: ['E', 'S'],
    requiredSubjects: {},
    exams: ['CAT', 'XAT', 'GMAT (later)'],
    topColleges: ['IIM Ahmedabad', 'IIM Bangalore', 'ISB'],
    salaryRange: '₹5–unlimited LPA',
    description: 'Build and run your own business ventures',
    gradeRelevance: [9, 10, 11, 12],
  },
];
