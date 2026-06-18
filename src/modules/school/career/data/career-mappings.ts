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
  duration: string;
  educationPath: string[];
  keySkills: string[];
  jobRoles: string[];
  prosCons: {
    pros: string[];
    cons: string[];
  };
  focusAreas?: string[];
}

export const CAREER_PATHS: CareerPath[] = [
  // ── Science stream ──────────────────────────────────────────────────────────
  {
    id: 'medicine',
    title: 'Medicine (MBBS/BDS)',
    stream: 'science',
    hollandMatch: ['I', 'S'],
    requiredSubjects: { biology: 80, chemistry: 75, physics: 60 },
    exams: ['NEET UG'],
    topColleges: ['AIIMS Delhi', 'CMC Vellore', 'JIPMER Pondicherry', 'KGMU Lucknow'],
    salaryRange: '₹8–50 LPA',
    description: 'Diagnose and treat patients across specialisations from general medicine to surgery.',
    gradeRelevance: [9, 10, 11, 12],
    duration: '5.5 Years (including 1 year compulsory internship)',
    educationPath: [
      'Complete Class 12 with PCB (Physics, Chemistry, Biology) and English.',
      'Qualify in the NEET-UG national entrance exam with a high percentile.',
      'Complete MBBS (4.5 years study + 1 year rotating internship) or BDS (5 years).',
      'Optionally qualify in NEET-PG for MD/MS specialisations (e.g., Surgery, Paediatrics).'
    ],
    keySkills: ['Medical Diagnostics', 'Clinical Procedures', 'Surgical Precision', 'Patient Care', 'Empathy'],
    jobRoles: ['General Physician', 'Specialist Doctor/Surgeon', 'Dentist', 'Medical Officer', 'Clinical Researcher'],
    prosCons: {
      pros: [
        'Highly respected and humanitarian profession.',
        'Exceptional job security and steady lifelong demand.',
        'High earning potential after MD/MS specialisation.'
      ],
      cons: [
        'Extremely long and physically demanding study duration.',
        'High stress levels and irregular, long working shifts.',
        'Requires continuous learning and updating of medical knowledge.'
      ]
    }
  },
  {
    id: 'engineering',
    title: 'Engineering (B.Tech)',
    stream: 'science',
    hollandMatch: ['R', 'I'],
    requiredSubjects: { mathematics: 80, physics: 75 },
    exams: ['JEE Mains', 'JEE Advanced', 'BITSAT', 'VITEEE', 'MHT CET'],
    topColleges: ['IIT Bombay', 'IIT Delhi', 'IIT Madras', 'NIT Trichy', 'BITS Pilani'],
    salaryRange: '₹6–40 LPA',
    description: 'Design and build technology solutions across software, hardware, civil, mechanical and chemical domains.',
    gradeRelevance: [9, 10, 11, 12],
    duration: '4 Years',
    educationPath: [
      'Complete Class 12 with PCM (Physics, Chemistry, Mathematics).',
      'Appear for JEE Mains, JEE Advanced, BITSAT, or state-level engineering exams.',
      'Secure admission to a B.Tech or B.E. program in your chosen branch.',
      'Develop hands-on technical projects, pursue internship roles, and gain core industry skills.'
    ],
    keySkills: ['Systems Design', 'Programming/Coding', 'Mathematical Modelling', 'Analytical Problem Solving', 'Technical Logic'],
    jobRoles: ['Software Engineer', 'Civil Engineer', 'Mechanical Engineer', 'Electronics Engineer', 'Project Engineer'],
    prosCons: {
      pros: [
        'Immense global career prospects and innovation opportunities.',
        'Very high starting salary packages in computer science and tech branches.',
        'Versatile degree which serves as a foundation for management or research.'
      ],
      cons: [
        'Highly competitive entrance exams and academic workload.',
        'Fast-paced industry requiring constant retraining and upskilling.',
        'Risk of desk-bound fatigue and screen-time exhaustion.'
      ]
    }
  },
  {
    id: 'data_science',
    title: 'Data Science / AI',
    stream: 'science',
    hollandMatch: ['I', 'C'],
    requiredSubjects: { mathematics: 85 },
    exams: ['JEE Mains', 'CUET', 'BITSAT'],
    topColleges: ['IITs', 'IIITs', 'BITS Pilani', 'ISI Kolkata', 'Delhi University'],
    salaryRange: '₹10–60 LPA',
    description: 'Analyse large datasets and build AI/ML models that power modern technology and business systems.',
    gradeRelevance: [10, 11, 12],
    duration: '3–4 Years',
    educationPath: [
      'Complete Class 12 with Mathematics.',
      'Pursue B.Tech in Computer Science/AI/Data Science, or B.Sc in Statistics/Mathematics/Computer Science.',
      'Learn languages like Python or R, databases (SQL), data visualization, and ML models.',
      'Optional: Complete an M.Tech or M.Sc in Data Science, or specialized professional certifications.'
    ],
    keySkills: ['Machine Learning Algorithms', 'Statistical Analysis', 'Python/R Programming', 'Data Visualisation', 'Database Management (SQL)'],
    jobRoles: ['Data Scientist', 'AI/ML Engineer', 'Data Analyst', 'Business Intelligence Developer', 'Data Architect'],
    prosCons: {
      pros: [
        'One of the fastest-growing and highest-paying sectors in technology.',
        'Applicable across diverse industries (Finance, Healthcare, E-commerce).',
        'Strong culture of remote and hybrid work.'
      ],
      cons: [
        'Requires a solid foundation in complex statistics and linear algebra.',
        'High competition for entry-level roles.',
        'Constantly evolving libraries and algorithms require continuous learning.'
      ]
    }
  },
  {
    id: 'architecture',
    title: 'Architecture',
    stream: 'science',
    hollandMatch: ['A', 'R'],
    requiredSubjects: { mathematics: 70 },
    exams: ['NATA', 'JEE Paper 2'],
    topColleges: ['SPA Delhi', 'CEPT Ahmedabad', 'IIT Kharagpur', 'IIT Roorkee'],
    salaryRange: '₹5–30 LPA',
    description: 'Design buildings, urban spaces, and sustainable physical infrastructure.',
    gradeRelevance: [10, 11, 12],
    duration: '5 Years',
    educationPath: [
      'Complete Class 12 with Physics, Chemistry, and Mathematics.',
      'Prepare and clear the National Aptitude Test in Architecture (NATA) or JEE Paper 2.',
      'Enroll in and complete a 5-year Bachelor of Architecture (B.Arch) degree.',
      'Register with the Council of Architecture (CoA) to legally practice as an architect.'
    ],
    keySkills: ['Spatial Design', 'CAD & 3D Drafting', 'Structural Science', 'Creative Visualization', 'Building Bylaws'],
    jobRoles: ['Architect', 'Urban Designer/Planner', 'Interior Designer', 'Landscape Architect', 'Conservation Architect'],
    prosCons: {
      pros: [
        'Highly creative and physically satisfying field where you see your designs take shape.',
        'Diverse avenues for independent consultancy and entrepreneurship.',
        'Growing demand for green and sustainable building experts.'
      ],
      cons: [
        'Long duration of 5 years with intensive studio and design submission workloads.',
        'Starting salaries can be low compared to engineering and tech.',
        'Heavily dependent on the real estate market cycles and client approvals.'
      ]
    }
  },
  {
    id: 'biotechnology',
    title: 'Biotechnology',
    stream: 'science',
    hollandMatch: ['I', 'R'],
    requiredSubjects: { biology: 75, chemistry: 70 },
    exams: ['NEET UG', 'CUET', 'JEE Mains'],
    topColleges: ['IIT Delhi', 'Delhi University', 'Manipal University', 'BHU Varanasi'],
    salaryRange: '₹4–25 LPA',
    description: 'Apply biological systems and living organisms to develop medicines, agricultural crops, and diagnostics.',
    gradeRelevance: [10, 11, 12],
    duration: '3–4 Years',
    educationPath: [
      'Complete Class 12 with PCB or PCMB (Physics, Chemistry, Biology, Mathematics).',
      'Pursue B.Tech Biotechnology (4 years) or B.Sc Biotechnology (3 years).',
      'Gain laboratory experience through research projects and industry internships.',
      'Earn an M.Sc, M.Tech, or Ph.D. for core research and clinical laboratory roles.'
    ],
    keySkills: ['Molecular Biology', 'Laboratory Techniques (PCR, Chromatography)', 'Bioinformatics', 'Research Methodology', 'Quality Control & Safety'],
    jobRoles: ['Research Scientist', 'Quality Control Analyst', 'Bioinformatician', 'Clinical Trial Coordinator', 'Bioproducts Developer'],
    prosCons: {
      pros: [
        'Work on meaningful solutions like vaccines, sustainable foods, and biofuels.',
        'High potential for research-driven breakthroughs.',
        'Expanding bio-economy with strong venture capital support.'
      ],
      cons: [
        'Undergraduate degrees often only lead to entry-level support roles; higher education is essential.',
        'R&D cycles are long and can suffer from high failure rates.',
        'Starting salaries in India are lower compared to IT fields.'
      ]
    }
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy (B.Pharm)',
    stream: 'science',
    hollandMatch: ['I', 'C'],
    requiredSubjects: { chemistry: 75, biology: 65 },
    exams: ['MHT CET', 'KCET', 'CUET', 'BITSAT', 'WBJEE'],
    topColleges: ['Jamia Hamdard Delhi', 'NIPER Mohali', 'BITS Pilani', 'Manipal College of Pharmaceutical Sciences'],
    salaryRange: '₹4–20 LPA',
    description: 'Understand drug compounds, develop medicines, and guide clinical pharmaceutical systems.',
    gradeRelevance: [10, 11, 12],
    duration: '4 Years',
    educationPath: [
      'Complete Class 12 with PCB or PCM.',
      'Clear national, state (e.g., MHT CET, KCET), or college entrance examinations.',
      'Obtain a Bachelor of Pharmacy (B.Pharm) degree.',
      'Register with the Pharmacy Council of India (PCI) to get a retail/distribution license.',
      'Optional: Appear for GPAT to pursue M.Pharm or Pharm.D for higher research.'
    ],
    keySkills: ['Pharmacology', 'Medicinal Chemistry', 'Quality Assurance & Regulatory Laws', 'Drug Compounding', 'Patient Counseling'],
    jobRoles: ['Pharmacist', 'Drug Inspector', 'Clinical Research Associate', 'R&D Chemist', 'Pharmaceutical Executive'],
    prosCons: {
      pros: [
        'Extremely stable sector unaffected by economic recessions.',
        'Diverse roles spanning hospital pharmacies, factory production, research, and sales.',
        'Allows starting an independent, profitable retail or manufacturing business.'
      ],
      cons: [
        'Heavily regulated environment with strict compliance burdens.',
        'Work can be repetitive in retail and production settings.',
        'Limited direct career growth in clinical roles without an M.Pharm/Pharm.D.'
      ]
    }
  },
  {
    id: 'environmental_science',
    title: 'Environmental Science',
    stream: 'science',
    hollandMatch: ['I', 'R'],
    requiredSubjects: { biology: 65, chemistry: 60 },
    exams: ['CUET', 'university entrance'],
    topColleges: ['JNU Delhi', 'Delhi University', 'BHU Varanasi', 'Amity University'],
    salaryRange: '₹4–18 LPA',
    description: 'Study ecosystems, assess human impacts, and shape environmental policies and conservation efforts.',
    gradeRelevance: [10, 11, 12],
    duration: '3 Years',
    educationPath: [
      'Complete Class 12 with Science (PCB or PCM).',
      'Pursue B.Sc in Environmental Science or B.Tech in Environmental Engineering.',
      'Do fieldwork, environmental impact assessment (EIA) projects, and learn GIS software.',
      'Earn an M.Sc or Ph.D. to take on senior consulting, advisory, or research roles.'
    ],
    keySkills: ['Ecology & Soil Science', 'GIS & Remote Sensing', 'Environmental Impact Assessment (EIA)', 'Field Sampling & Testing', 'Environmental Policy'],
    jobRoles: ['Environmental Consultant', 'Sustainability Analyst', 'EIA Officer', 'Conservation Officer', 'NGO Environmental Specialist'],
    prosCons: {
      pros: [
        'Highly satisfying work that directly tackles global issues like climate change.',
        'Growing demand in the corporate sector due to green energy and ESG mandates.',
        'Combines fieldwork, laboratory analysis, and office-based reporting.'
      ],
      cons: [
        'Lower initial salary scale compared to other science disciplines.',
        'Career options are highly dependent on government policies and compliance enforcement.',
        'Fieldwork can involve rough outdoor conditions and travel.'
      ]
    }
  },
  {
    id: 'nursing',
    title: 'Nursing (B.Sc Nursing)',
    stream: 'science',
    hollandMatch: ['S', 'I'],
    requiredSubjects: { biology: 70, chemistry: 55 },
    exams: ['AIIMS Nursing', 'NEET UG', 'State Nursing Entrance Exams'],
    topColleges: ['AIIMS Delhi', 'CMC Vellore', 'JIPMER Pondicherry', 'NIMHANS Bangalore'],
    salaryRange: '₹3–15 LPA',
    description: 'Provide direct patient care, support recovery in clinical settings, and manage healthcare logs.',
    gradeRelevance: [10, 11, 12],
    duration: '4 Years',
    educationPath: [
      'Complete Class 12 with Physics, Chemistry, Biology, and English.',
      'Clear university entrance examinations or state-level nursing tests.',
      'Earn a B.Sc Nursing degree.',
      'Register with the Indian Nursing Council (INC) or State Nursing Council.',
      'Gain hospital experience or specialise in ICU, Neonatal, or Anaesthesia nursing.'
    ],
    keySkills: ['Patient Assessment & Vitals', 'Emergency Response & First Aid', 'Medication Administration', 'Empathy & Communication', 'Medical Record Keeping'],
    jobRoles: ['Staff Nurse', 'Critical Care Nurse', 'Nurse Educator', 'Nursing Superintendent', 'Community Health Nurse'],
    prosCons: {
      pros: [
        'Immense job security and rapid placement post-degree.',
        'Huge international travel and immigration opportunities (high demand in UK/US/Gulf).',
        'Direct, daily impact on patient recovery and wellness.'
      ],
      cons: [
        'High physical strain, standing for long periods, and lifting patients.',
        'Frequent night, holiday, and weekend shifts.',
        'Risk of occupational exposure to infectious diseases.'
      ]
    }
  },
  {
    id: 'veterinary_science',
    title: 'Veterinary Science (BVSc)',
    stream: 'science',
    hollandMatch: ['I', 'S'],
    requiredSubjects: { biology: 75, chemistry: 65 },
    exams: ['NEET UG', 'State Veterinary Exams'],
    topColleges: ['IVRI Bareilly', 'Bombay Veterinary College', 'GADVASU Ludhiana', 'TANUVAS Chennai'],
    salaryRange: '₹4–20 LPA',
    description: 'Diagnose and treat illnesses, perform surgeries, and manage wellness for domestic and wild animals.',
    gradeRelevance: [10, 11, 12],
    duration: '5.5 Years (including 1 year internship)',
    educationPath: [
      'Complete Class 12 with PCB (Physics, Chemistry, Biology).',
      'Appear for NEET-UG or specific state-level veterinary examinations.',
      'Complete Bachelor of Veterinary Science and Animal Husbandry (B.V.Sc & AH).',
      'Register with the Veterinary Council of India (VCI) or state council to practice.',
      'Optional: Complete an M.V.Sc to specialise in Veterinary Surgery, Medicine, or pathology.'
    ],
    keySkills: ['Animal Diagnostics & Care', 'Veterinary Surgery', 'Animal Behaviour Interpretation', 'Public Health & Zoonosis', 'Compassion'],
    jobRoles: ['Veterinary Surgeon', 'Livestock Development Officer', 'Pet Clinic Owner', 'Zoo/Wildlife Veterinarian', 'Animal Nutritionist'],
    prosCons: {
      pros: [
        'Very high job satisfaction for animal lovers.',
        'Growing pet industry has driven demand for private urban clinics.',
        'Good opportunities in public sector livestock departments.'
      ],
      cons: [
        'Risk of physical injury (bites, scratches, kicks) from scared animals.',
        'Animals cannot speak, which makes diagnosis much harder.',
        'Emotional fatigue from dealing with pet owners and euthanasia.'
      ]
    }
  },

  // ── Commerce stream ─────────────────────────────────────────────────────────
  {
    id: 'chartered_accountancy',
    title: 'Chartered Accountancy (CA)',
    stream: 'commerce',
    hollandMatch: ['C', 'E'],
    requiredSubjects: { mathematics: 65, accountancy: 75 },
    exams: ['CA Foundation', 'CA Intermediate', 'CA Final'],
    topColleges: ['ICAI (Institute of Chartered Accountants of India - Self-study / coaching model)'],
    salaryRange: '₹8–40 LPA',
    description: 'Manage accounting audits, tax planning, financial statements, and business consulting.',
    gradeRelevance: [10, 11, 12],
    duration: '4.5–5 Years',
    educationPath: [
      'Register for and clear the CA Foundation exam after Class 12.',
      'Complete and pass the CA Intermediate exam (both groups).',
      'Complete 2 years of practical articleship training under a practicing CA.',
      'Complete administrative/IT training and qualify in the CA Final examinations.',
      'Enroll as a member of the Institute of Chartered Accountants of India (ICAI).'
    ],
    keySkills: ['Financial Auditing', 'Corporate & Income Tax Laws', 'Financial Reporting', 'Analytical Auditing', 'Regulatory Compliance'],
    jobRoles: ['Chartered Accountant', 'Statutory Auditor', 'Financial Analyst', 'Tax Advisor', 'Chief Financial Officer (CFO)'],
    prosCons: {
      pros: [
        'High social respect, professional status, and job security.',
        'Opportunity to start your own auditing/consultancy practice.',
        'Indispensable role in every corporate house.'
      ],
      cons: [
        'Exams have extremely low pass percentages, requiring immense resilience.',
        'Very stressful work schedule during corporate auditing and tax-filing seasons.',
        'Intense articleship training with a modest stipend.'
      ]
    }
  },
  {
    id: 'finance_banking',
    title: 'Finance & Banking',
    stream: 'commerce',
    hollandMatch: ['C', 'E'],
    requiredSubjects: { mathematics: 70, economics: 65 },
    exams: ['CUET', 'IPMAT', 'CAT', 'IBPS PO', 'SBI PO'],
    topColleges: ['SRCC Delhi', 'LSR Delhi', 'St. Xavier\'s College Mumbai', 'IIM Ahmedabad (MBA)', 'NMIMS Mumbai'],
    salaryRange: '₹5–35 LPA',
    description: 'Manage investments, corporate finance, commercial banking, and financial portfolios.',
    gradeRelevance: [10, 11, 12],
    duration: '3 Years (Undergrad) / +2 Years (MBA)',
    educationPath: [
      'Complete Class 12 with Commerce (Mathematics strongly recommended).',
      'Earn a B.Com (Hons), BBA (Finance), or B.A. Economics degree.',
      'Prepare and clear banking exams (IBPS/SBI PO) or qualify in CAT/GMAT for an MBA in Finance.',
      'Optionally obtain international credentials like CFA (Chartered Financial Analyst) or FRM.'
    ],
    keySkills: ['Financial Modeling', 'Market Valuation', 'Portfolio Management', 'Excel & Analytics tools', 'Risk Assessment'],
    jobRoles: ['Investment Banker', 'Financial Analyst', 'Portfolio Manager', 'Bank Probationary Officer (PO)', 'Risk Analyst'],
    prosCons: {
      pros: [
        'Highly lucrative salary structure, especially in investment banking.',
        'Fast-paced, mentally stimulating corporate environment.',
        'Clear, structured paths for promotions and career growth.'
      ],
      cons: [
        'Extremely long hours in investment banking and consulting (70-80 hr weeks).',
        'High stress levels tied to market performance and deal deadlines.',
        'Requires constant adaptation to macroeconomic changes.'
      ]
    }
  },

  // ── Arts / Humanities stream ─────────────────────────────────────────────────
  {
    id: 'law',
    title: 'Law (LLB)',
    stream: 'any',
    hollandMatch: ['E', 'S'],
    requiredSubjects: { english: 75 },
    exams: ['CLAT', 'AILET', 'LSAT India', 'MHCET Law'],
    topColleges: ['NLSIU Bangalore', 'NALSAR Hyderabad', 'NLU Delhi', 'WBNUJS Kolkata', 'ILS Pune'],
    salaryRange: '₹6–50 LPA',
    description: 'Draft legal agreements, counsel clients, represent entities in courts, and defend civil liberties.',
    gradeRelevance: [10, 11, 12],
    duration: '5 Years (Integrated) / 3 Years (Post-Grad)',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Clear CLAT, AILET, or regional law examinations.',
      'Complete a 5-year integrated law program (e.g., B.A. LLB, BBA LLB).',
      'Pass the All India Bar Examination (AIBE) administered by the Bar Council of India.',
      'Practice in courts or join a corporate law firm.'
    ],
    keySkills: ['Legal Research', 'Contract Drafting', 'Advocacy & Public Speaking', 'Logical Argumentation', 'Negotiation Skills'],
    jobRoles: ['Corporate Lawyer', 'Litigation Advocate', 'Legal Advisor/In-House Counsel', 'Judicial Officer', 'Legal Consultant'],
    prosCons: {
      pros: [
        'Diverse specialisations (Corporate, IPR, Criminal, Environmental).',
        'Strong sense of empowerment and capability to defend justice.',
        'Lucrative salaries in corporate firms.'
      ],
      cons: [
        'Early years in independent litigation are financially difficult and slow.',
        'Massive volumes of reading, documentation, and case research.',
        'Aggressive and high-pressure court environment.'
      ]
    }
  },
  {
    id: 'journalism',
    title: 'Journalism & Media',
    stream: 'arts',
    hollandMatch: ['A', 'S'],
    requiredSubjects: { english: 80 },
    exams: ['IIMC Entrance', 'XIC OET', 'CUET'],
    topColleges: ['IIMC New Delhi', 'AJK MCRC Jamia Millia Delhi', 'ACJ Chennai', 'Symbiosis Pune'],
    salaryRange: '₹4–25 LPA',
    description: 'Investigate, report, write, and produce news across print, television, radio, and digital media.',
    gradeRelevance: [10, 11, 12],
    duration: '3 Years',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Complete a Bachelor of Journalism & Mass Communication (BJMC) or B.A. in Journalism.',
      'Build a strong portfolio of articles, blogs, audio segments, or video reports.',
      'Apply for internships at newspapers, digital publications, or news channels.',
      'Optional: Complete a PG Diploma in Journalism from institutes like IIMC or ACJ.'
    ],
    keySkills: ['Investigative Reporting', 'Feature Writing & Editing', 'Digital Media Production', 'Networking & Sourcing', 'Interviewing'],
    jobRoles: ['News Reporter', 'Sub-Editor', 'News Anchor', 'Content Producer', 'Investigative Journalist'],
    prosCons: {
      pros: [
        'Exciting, dynamic work with no routine office days.',
        'Chance to interact with key public figures and make an impact.',
        'Wide scope for creative writing and reporting.'
      ],
      cons: [
        'Irregular working hours, constant deadlines, and holiday duties.',
        'Relatively lower starting salaries compared to other professional degrees.',
        'Risk of physical hazard in conflict, investigative, or disaster zones.'
      ]
    }
  },
  {
    id: 'design',
    title: 'Design (UX/Fashion/Graphic)',
    stream: 'arts',
    hollandMatch: ['A', 'R'],
    requiredSubjects: {},
    exams: ['NID DAT', 'UCEED', 'NIFT Exam', 'CEED'],
    topColleges: ['NID Ahmedabad', 'NIFT Delhi', 'IDC IIT Bombay', 'Srishti Institute Bengaluru'],
    salaryRange: '₹5–35 LPA',
    description: 'Create products, visual designs, brand assets, user interfaces, or fashion garments.',
    gradeRelevance: [10, 11, 12],
    duration: '4 Years',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Appear for UCEED, NID DAT, or NIFT entrance exams.',
      'Earn a Bachelor of Design (B.Des) in UX, Visual Communication, Fashion, or Product Design.',
      'Create a digital portfolio showcasing your design process and projects.',
      'Secure internships to understand market trends and client work.'
    ],
    keySkills: ['Visual Composition & Typography', 'UI/UX Tools (Figma, Adobe XD)', 'User Research & Prototyping', 'Creative Styling', 'Design Thinking'],
    jobRoles: ['UI/UX Designer', 'Graphic Designer', 'Fashion Designer', 'Product Designer', 'Creative Director'],
    prosCons: {
      pros: [
        'High room for creative expression and visual styling.',
        'Vast remote work, contract, and freelance opportunities.',
        'Lucrative salaries for UX and digital product designers.'
      ],
      cons: [
        'Subjective feedback from clients can require multiple revisions.',
        'High competitive pressure to constantly update design portfolios.',
        'Possibility of creative burnout due to demanding deadlines.'
      ]
    }
  },
  {
    id: 'psychology',
    title: 'Psychology / Counselling',
    stream: 'arts',
    hollandMatch: ['S', 'I'],
    requiredSubjects: { english: 70 },
    exams: ['CUET', 'university entrance'],
    topColleges: ['Delhi University', 'Christ University Bangalore', 'TISS Mumbai', 'NIMHANS Bangalore'],
    salaryRange: '₹4–20 LPA',
    description: 'Study human behaviour, conduct research, and provide counselling or therapy to support mental health.',
    gradeRelevance: [10, 11, 12],
    duration: '3 Years (B.A./B.Sc.) + 2 Years (M.A./M.Sc.)',
    educationPath: [
      'Complete Class 12 in any stream (Psychology background is helpful).',
      'Complete a Bachelor\'s degree (B.A. or B.Sc) in Psychology.',
      'Earn a Master\'s degree (M.A. or M.Sc) in Clinical, Counselling, or Organisational Psychology.',
      'For Clinical Psychology, complete an RCI-approved M.Phil in Clinical Psychology.',
      'Get licensed and begin practice in clinics, schools, or corporates.'
    ],
    keySkills: ['Active Listening', 'Empathic Communication', 'Psychological Testing', 'Cognitive Behavioural Therapy (CBT)', 'Patience'],
    jobRoles: ['Clinical Psychologist', 'Counselling Psychologist', 'School Counsellor', 'HR Specialist', 'Rehabilitation Specialist'],
    prosCons: {
      pros: [
        'Deeply rewarding field where you help people overcome mental challenges.',
        'Rapidly increasing public awareness and corporate demand for mental health support.',
        'Flexible working models (private clinic, online practice, corporate training).'
      ],
      cons: [
        'Long academic path (at least a Master\'s degree is required to practice legally).',
        'High risk of emotional and mental fatigue from absorbing client trauma.',
        'Early-stage salary packages are low before establishing a reputation.'
      ]
    }
  },
  {
    id: 'social_work',
    title: 'Social Work / NGO',
    stream: 'arts',
    hollandMatch: ['S', 'A'],
    requiredSubjects: { english: 60 },
    exams: ['CUET PG', 'university entrance'],
    topColleges: ['TISS Mumbai', 'Delhi School of Social Work (DU)', 'Loyola College Chennai', 'IISWBM Kolkata'],
    salaryRange: '₹3–15 LPA',
    description: 'Advocate for vulnerable communities, formulate social policies, and execute welfare projects.',
    gradeRelevance: [10, 11, 12],
    duration: '3 Years (BSW) / +2 Years (MSW)',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Pursue a Bachelor of Social Work (BSW) or B.A. in Sociology/Social Sciences.',
      'Prepare and clear entrance exams for Master of Social Work (MSW).',
      'Do field exposure and rural projects under NGOs or public welfare departments.'
    ],
    keySkills: ['Community Organizing', 'Crisis Intervention', 'Public Policy Analysis', 'Fundraising & Grant Writing', 'Social Counseling'],
    jobRoles: ['Social Worker', 'CSR Executive', 'NGO Program Officer', 'Community Mobilizer', 'Welfare Administrator'],
    prosCons: {
      pros: [
        'Immense personal satisfaction making a direct difference at the grassroots.',
        'Growing career tracks in corporate CSR (Corporate Social Responsibility) setups.',
        'Work on diverse real-world problems like sanitation, human rights, and literacy.'
      ],
      cons: [
        'Very low initial pay scales in traditional NGOs.',
        'Frequent exposure to heavy, challenging, and emotionally demanding environments.',
        'Resource constraints can make project execution frustrating.'
      ]
    }
  },
  {
    id: 'performing_arts',
    title: 'Performing Arts / Music / Film',
    stream: 'arts',
    hollandMatch: ['A', 'S'],
    requiredSubjects: {},
    exams: ['FTII Entrance Exam', 'NSD Entrance Auditions', 'university auditions'],
    topColleges: ['FTII Pune', 'National School of Drama (NSD) Delhi', 'SRFTI Kolkata', 'KM Music Conservatory Chennai'],
    salaryRange: '₹3–unlimited LPA',
    description: 'Express artistic stories through acting, musical performance, film directing, or theatrical design.',
    gradeRelevance: [9, 10, 11, 12],
    duration: '3–4 Years (Degree optional, portfolio-driven)',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Join specialized courses in acting, music, or film editing (optional).',
      'Build a strong portfolio (audition reels, short films, original compositions).',
      'Network actively with agents, cast directors, and independent producers.',
      'Perform in theatre shows, music gigs, or digital formats.'
    ],
    keySkills: ['Stage Presence / Performance', 'Creative Storytelling', 'Cinematography / Sound Design', 'Audition Execution', 'Patience & Resilience'],
    jobRoles: ['Actor/Performer', 'Film Director', 'Music Producer/Composer', 'Screenwriter', 'Cinematographer'],
    prosCons: {
      pros: [
        'High scope for artistic freedom, personal expression, and public fame.',
        'Extremely dynamic, creative, and collaborative working environment.',
        'Uncapped financial rewards for successful projects.'
      ],
      cons: [
        'Very high financial instability, especially in the initial years.',
        'Heavily dependent on networking and subjective selection choices.',
        'Dealing with constant rejection at audits and casting calls.'
      ]
    }
  },

  // ── Stream-agnostic ─────────────────────────────────────────────────────────
  {
    id: 'entrepreneurship',
    title: 'Entrepreneurship / Business',
    stream: 'any',
    hollandMatch: ['E', 'S'],
    requiredSubjects: {},
    exams: ['CAT', 'XAT', 'IPMAT', 'GMAT'],
    topColleges: ['IIM Ahmedabad', 'IIM Bangalore', 'IIM Calcutta', 'ISB Hyderabad', 'FMS Delhi'],
    salaryRange: '₹5–unlimited LPA',
    description: 'Launch, manage, and scale startup ventures and independent commercial products.',
    gradeRelevance: [9, 10, 11, 12],
    duration: 'Self-driven / 3–4 Years (degree foundation)',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Pursue BBA, B.Com, or B.Tech to acquire fundamental technical/business knowledge.',
      'Gain work experience to identify consumer pain-points.',
      'Draft a business plan, build a Minimum Viable Product (MVP), and seek angel/VC funding.',
      'Scale your team and expand marketing channels.'
    ],
    keySkills: ['Business Strategy', 'Financial Management & Budgeting', 'Sales & Pitching', 'Leadership & Team Building', 'Risk Management'],
    jobRoles: ['Founder / CEO', 'Co-Founder', 'Product Manager', 'Business Development Manager', 'Venture Analyst'],
    prosCons: {
      pros: [
        'Total independence—be your own boss and shape your vision.',
        'Uncapped financial potential and business equity.',
        'Ability to create jobs and generate massive economic impact.'
      ],
      cons: [
        'Extremely high failure rate of startups and personal financial risks.',
        'Highly stressful, requiring 80-hour workweeks with zero initial guarantees.',
        'Requires handling constant ambiguity and pressure.'
      ]
    }
  },
  {
    id: 'civil_services',
    title: 'Civil Services (IAS/IPS/IFS)',
    stream: 'any',
    hollandMatch: ['E', 'S'],
    requiredSubjects: {},
    exams: ['UPSC CSE', 'State PSC'],
    topColleges: ['Any recognized graduation degree. Post-exam training at LBSNAA Mussoorie or SVPNPA Hyderabad'],
    salaryRange: '₹7–20 LPA + perks',
    description: 'Serve the public and administer government departments as an IAS, IPS, or IFS officer.',
    gradeRelevance: [10, 11, 12],
    duration: '1–2 Years (Exam Prep) after completing Graduation',
    educationPath: [
      'Complete a Bachelor\'s degree in any stream (e.g., B.A., B.Sc, B.Tech) from a recognized university.',
      'Select optional subjects and start prep for the UPSC CSE (Civil Services Exam).',
      'Appear and clear the UPSC Prelims, Mains, and the Personality Interview.',
      'Undergo specialized administrative/police training at LBSNAA or SVPNPA based on ranks.'
    ],
    keySkills: ['Public Administration', 'Policy Understanding', 'Decision Making', 'Integrity & Ethics', 'General Knowledge'],
    jobRoles: ['District Magistrate (IAS)', 'Superintendent of Police (IPS)', 'Diplomat (IFS)', 'Revenue Commissioner (IRS)'],
    prosCons: {
      pros: [
        'Immense executive authority and power to implement systemic change.',
        'High prestige, job security, and official government perks.',
        'Highly impactful public career addressing social welfare.'
      ],
      cons: [
        'Extremely low success rate in exams (<0.1%), requiring years of intense preparation.',
        'Bureaucratic red tape and political pressures in executive work.',
        'Frequent transfers to diverse districts and rural postings.'
      ]
    }
  },
  {
    id: 'teaching',
    title: 'Teaching / Education',
    stream: 'any',
    hollandMatch: ['S', 'A'],
    requiredSubjects: {},
    exams: ['CTET', 'NET/JRF', 'State TET'],
    topColleges: ['RIE NCERT', 'Delhi University (CIE)', 'Jamia Millia Islamia Delhi', 'BHU Varanasi'],
    salaryRange: '₹3–20 LPA',
    description: 'Teach school students, lecture in colleges, or develop curriculum and educational content.',
    gradeRelevance: [9, 10, 11, 12],
    duration: '2 Years (B.Ed) / 3–4 Years (B.El.Ed)',
    educationPath: [
      'Complete Graduation in your chosen subject area (Science/Arts/Commerce).',
      'Enroll in and complete a Bachelor of Education (B.Ed) degree.',
      'Clear the CTET (Central Teacher Eligibility Test) or State TET exam to qualify for school jobs.',
      'For college lectureship: Complete postgraduation and qualify in UGC NET.'
    ],
    keySkills: ['Pedagogy & Lesson Planning', 'Classroom Management', 'Student Assessment', 'Patience & Empathy', 'Public Speaking'],
    jobRoles: ['School Teacher (PRT/TGT/PGT)', 'College Professor/Lecturer', 'Education Consultant', 'Curriculum Developer', 'School Administrator'],
    prosCons: {
      pros: [
        'Highly stable and fulfilling career shaping the next generation.',
        'Good work-life balance with standard school hours and academic holidays.',
        'Constant opportunity for personal academic enrichment.'
      ],
      cons: [
        'Relatively lower starting salary structures in private institutions.',
        'Heavy non-teaching administrative and grading burdens.',
        'Requires dealing with student behavioural issues and parent feedback.'
      ]
    }
  },
  {
    id: 'defense',
    title: 'Defense Services (Army/Navy/Air Force)',
    stream: 'any',
    hollandMatch: ['R', 'E'],
    requiredSubjects: { physics: 60, mathematics: 60 },
    exams: ['NDA', 'CDS', 'AFCAT'],
    topColleges: ['National Defence Academy Khadakwasla', 'IMA Dehradun', 'Indian Naval Academy Ezhimala', 'AFA Hyderabad'],
    salaryRange: '₹6–25 LPA + allowances',
    description: 'Serve and defend the nation through a commissioned officer career in the armed forces.',
    gradeRelevance: [9, 10, 11, 12],
    duration: '3–4 Years training at Military Academies',
    educationPath: [
      'Appear for the NDA written exam after Class 12 (Maths & Physics required for Navy/Air Force).',
      'Pass the Services Selection Board (SSB) interviews, physicals, and medical tests.',
      'Undergo 3 years of academic/military training at NDA followed by 1 year at IMA/INA/AFA.',
      'Alternative path: Clear CDS or AFCAT exams after completing Graduation.'
    ],
    keySkills: ['Military Tactics', 'Physical Endurance', 'Leadership & Command', 'Crisis Management', 'Weapon Systems Handling'],
    jobRoles: ['Lieutenant (Army)', 'Sub-Lieutenant (Navy)', 'Flying Officer (Air Force)', 'Technical Logistics Officer'],
    prosCons: {
      pros: [
        'Highly adventurous, disciplined, and prestigious lifestyle.',
        'Excellent health benefits, travel concessions, pension, and housing allowances.',
        'Great avenues for athletic sports and physical fitness.'
      ],
      cons: [
        'High risk to life during border duties, anti-terror ops, and postings.',
        'Frequent transfers and long separation from family members.',
        'Rigid discipline with zero flexibility for personal leaves.'
      ]
    }
  },
  {
    id: 'hospitality',
    title: 'Hospitality & Hotel Management',
    stream: 'any',
    hollandMatch: ['E', 'S'],
    requiredSubjects: {},
    exams: ['NCHMCT JEE', 'IIHM eCHAT'],
    topColleges: ['IHM Pusa Delhi', 'IHM Mumbai', 'Welcomgroup Graduate School Manipal', 'IHM Bangalore'],
    salaryRange: '₹3–20 LPA',
    description: 'Manage resorts, cruise operations, luxury hotels, culinary spaces, and corporate events.',
    gradeRelevance: [10, 11, 12],
    duration: '3 Years',
    educationPath: [
      'Complete Class 12 in any stream with English as a subject.',
      'Qualify in the NCHMCT JEE national entrance examination.',
      'Earn a B.Sc in Hospitality and Hotel Administration.',
      'Acquire hands-on training in front office, kitchen, housekeeping, and F&B services.',
      'Join premium hotel chains through Management Trainee programs.'
    ],
    keySkills: ['Guest Relations', 'F&B Operations & Culinary skills', 'Event Planning', 'Staff Coordination', 'Problem Resolution'],
    jobRoles: ['Hotel Manager', 'Executive Chef', 'F&B Manager', 'Front Office Executive', 'Event/Banquet Coordinator'],
    prosCons: {
      pros: [
        'Global work opportunities in luxury hotels, cruise lines, and resorts.',
        'Highly social and dynamic working environments.',
        'Fast promotion path for candidates with good management skills.'
      ],
      cons: [
        'Extremely long shifts, including overnight and holiday duties.',
        'Physically tiring work (standing for long periods).',
        'Necessity of dealing with difficult, demanding, or angry guests.'
      ]
    }
  },
  {
    id: 'sports',
    title: 'Sports & Physical Education',
    stream: 'any',
    hollandMatch: ['R', 'S'],
    requiredSubjects: {},
    exams: ['LNUPE Entrance', 'NIS Patiala Diploma Entrance', 'university sports trials'],
    topColleges: ['LNUPE Gwalior', 'NIS Patiala (NSNIS)', 'Tamil Nadu Physical Education University'],
    salaryRange: '₹3–unlimited LPA',
    description: 'Build a career as a professional athlete, sports trainer, physical education teacher, or sports analyst.',
    gradeRelevance: [9, 10, 11, 12],
    duration: '3 Years (BPEd/B.Sc Sports) or athletic track',
    educationPath: [
      'Complete Class 12 in any stream.',
      'Compete actively in state/national level tournaments.',
      'Pursue a B.P.Ed (Bachelor of Physical Education) or B.Sc in Sports Science.',
      'To coach: Clear the NSNIS (NIS Patiala) Diploma in Sports Coaching.',
      'For fitness: Get certified in Personal Training or Strength & Conditioning.'
    ],
    keySkills: ['Athletic Performance', 'Fitness Coaching & Anatomy', 'Sports Nutrition & Hydration', 'First Aid & Rehab', 'Game Tactics'],
    jobRoles: ['Professional Athlete', 'Sports Coach', 'Physical Education (PE) Teacher', 'Athletic/Fitness Trainer', 'Sports Manager'],
    prosCons: {
      pros: [
        'Work within your passion and stay highly fit and active.',
        'High fame and lucrative rewards at national or franchise levels (e.g., IPL).',
        'Diverse avenues from schools to premium corporate fitness centers.'
      ],
      cons: [
        'High risk of career-threatening injuries.',
        'Highly competitive pathway with limited national squad slots.',
        'Short career longevity for active athletes (often retired by late 30s).'
      ]
    }
  },
  {
    id: 'aviation',
    title: 'Aviation (Pilot / Airport Management)',
    stream: 'science',
    hollandMatch: ['R', 'E'],
    requiredSubjects: { physics: 70, mathematics: 70 },
    exams: ['IGRUA Entrance Exam', 'NDA (Air Force)', 'AFCAT', 'DGCA Class 2 Medicals'],
    topColleges: ['Indira Gandhi Rashtriya Uran Akademi (IGRUA) Raebareli', 'National Flying Training Institute (NFTI) Gondia', 'CAE Oxford Aviation Academy'],
    salaryRange: '₹8–50 LPA',
    description: 'Fly commercial airliners or manage airport logistics, aviation safety, and scheduling systems.',
    gradeRelevance: [10, 11, 12],
    duration: '1.5–3 Years (Pilot training) / 3 Years (BBA Aviation)',
    educationPath: [
      'Complete Class 12 with Physics and Mathematics.',
      'Undergo and clear a DGCA Class 2 medical examination.',
      'Join an approved flying training organization (FTO) for Commercial Pilot License (CPL) training.',
      'Clear DGCA theoretical papers (Air Navigation, Meteorology, Air Regulations, etc.).',
      'Complete 200 hours of flight time, obtain CPL, and undergo Type Rating for airline jets.'
    ],
    keySkills: ['Spatial Navigation', 'Instruments Reading', 'Technical Flight Rules', 'Emergency Decision Making', 'Radio Communication'],
    jobRoles: ['Commercial Pilot', 'Flight Instructor', 'Co-Pilot / First Officer', 'Air Traffic Controller', 'Airport Operations Manager'],
    prosCons: {
      pros: [
        'Highly prestigious, high-paying, and adventurous job.',
        'Chance to travel globally and work in state-of-the-art cockpits.',
        'Clear and structured seniority increments.'
      ],
      cons: [
        'Extremely expensive training pathway (costs ₹50-80 Lakhs in India).',
        'Strict health/medical guidelines checked annually.',
        'Constant jet lag, irregular schedules, and extended stays away from family.'
      ]
    }
  }
];
