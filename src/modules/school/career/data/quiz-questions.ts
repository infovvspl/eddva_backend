// Interest quiz (Holland/RIASEC) — questions never change, so they live as a
// constant rather than in the DB.

export type HollandLetter = 'R' | 'I' | 'A' | 'S' | 'E' | 'C';

export interface QuizOption {
  value: HollandLetter;
  label: string;
}

export interface QuizQuestion {
  id: string;
  section: string;
  question: string;
  options: QuizOption[];
}

export const INTEREST_QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    section: 'interests',
    question: 'In my free time, I prefer to:',
    options: [
      { value: 'R', label: 'Build or fix things with my hands' },
      { value: 'I', label: 'Research and learn new things' },
      { value: 'A', label: 'Draw, write, or create something' },
      { value: 'S', label: 'Spend time with and help people' },
      { value: 'E', label: 'Organise events or lead a group' },
      { value: 'C', label: 'Organise, sort, and manage things' },
    ],
  },
  {
    id: 'q2',
    section: 'interests',
    question: 'The school subject I enjoy most is:',
    options: [
      { value: 'R', label: 'Physics or Physical Education' },
      { value: 'I', label: 'Mathematics or Science' },
      { value: 'A', label: 'Art, Music, or Literature' },
      { value: 'S', label: 'Social Studies or Psychology' },
      { value: 'E', label: 'Commerce or Entrepreneurship' },
      { value: 'C', label: 'Accountancy or Computer Science' },
    ],
  },
  {
    id: 'q3',
    section: 'interests',
    question: 'My ideal project would involve:',
    options: [
      { value: 'R', label: 'Building or assembling something' },
      { value: 'I', label: 'Analysing data and finding patterns' },
      { value: 'A', label: 'Designing or performing' },
      { value: 'S', label: 'Helping or teaching others' },
      { value: 'E', label: 'Pitching an idea or selling' },
      { value: 'C', label: 'Tracking details and keeping records' },
    ],
  },
  {
    id: 'q4',
    section: 'work_style',
    question: 'I work best when:',
    options: [
      { value: 'R', label: 'I am doing something physical or hands-on' },
      { value: 'I', label: 'I can think and solve problems independently' },
      { value: 'A', label: 'I have freedom to be creative' },
      { value: 'S', label: 'I am collaborating with a team' },
      { value: 'E', label: 'I am leading and making decisions' },
      { value: 'C', label: 'I have clear rules and structured tasks' },
    ],
  },
  {
    id: 'q5',
    section: 'work_style',
    question: 'I am most proud when I:',
    options: [
      { value: 'R', label: 'Complete a physical or technical challenge' },
      { value: 'I', label: 'Solve a difficult problem nobody else could' },
      { value: 'A', label: 'Create something original and beautiful' },
      { value: 'S', label: 'Help someone through a difficult time' },
      { value: 'E', label: 'Convince or inspire others' },
      { value: 'C', label: 'Organise something perfectly' },
    ],
  },
  {
    id: 'q6',
    section: 'work_style',
    question: 'When facing a problem I usually:',
    options: [
      { value: 'R', label: 'Try things out hands-on until it works' },
      { value: 'I', label: 'Research and gather information first' },
      { value: 'A', label: 'Think of a creative unconventional approach' },
      { value: 'S', label: 'Ask others for their opinions and help' },
      { value: 'E', label: 'Take charge and delegate tasks' },
      { value: 'C', label: 'Follow a step-by-step methodical approach' },
    ],
  },
  {
    id: 'q7',
    section: 'environment',
    question: 'My ideal work environment is:',
    options: [
      { value: 'R', label: 'Outdoors or in a workshop/lab' },
      { value: 'I', label: 'A quiet office or research facility' },
      { value: 'A', label: 'A studio, stage, or creative space' },
      { value: 'S', label: 'A school, hospital, or community centre' },
      { value: 'E', label: 'A corporate office or business setting' },
      { value: 'C', label: 'A well-organised office with clear processes' },
    ],
  },
  {
    id: 'q8',
    section: 'environment',
    question: 'I prefer tasks that are:',
    options: [
      { value: 'R', label: 'Physical and hands-on' },
      { value: 'I', label: 'Complex and intellectually challenging' },
      { value: 'A', label: 'Open-ended with room for imagination' },
      { value: 'S', label: 'People-focused and relationship-based' },
      { value: 'E', label: 'Goal-driven with measurable results' },
      { value: 'C', label: 'Structured with clear steps and deadlines' },
    ],
  },
  {
    id: 'q9',
    section: 'values',
    question: 'What matters most to me in a future career:',
    options: [
      { value: 'R', label: 'Using my physical or technical skills' },
      { value: 'I', label: 'Continuous learning and discovery' },
      { value: 'A', label: 'Expressing myself and being creative' },
      { value: 'S', label: 'Making a positive impact on people' },
      { value: 'E', label: 'Financial success and recognition' },
      { value: 'C', label: 'Stability, security, and clear growth' },
    ],
  },
  {
    id: 'q10',
    section: 'values',
    question: 'My friends would describe me as:',
    options: [
      { value: 'R', label: 'Practical and good with tools/tech' },
      { value: 'I', label: 'Curious and always asking questions' },
      { value: 'A', label: 'Creative and imaginative' },
      { value: 'S', label: 'Caring, kind, and a good listener' },
      { value: 'E', label: 'Confident, persuasive, and ambitious' },
      { value: 'C', label: 'Reliable, organised, and detail-oriented' },
    ],
  },
  {
    id: 'q11',
    section: 'aspirations',
    question: 'At age 30, I imagine myself:',
    options: [
      { value: 'R', label: 'As a skilled engineer, doctor, or technician' },
      { value: 'I', label: 'As a researcher, scientist, or analyst' },
      { value: 'A', label: 'As an artist, designer, or performer' },
      { value: 'S', label: 'As a teacher, counsellor, or social worker' },
      { value: 'E', label: 'Running my own business or leading a team' },
      { value: 'C', label: 'As a banker, accountant, or administrator' },
    ],
  },
  {
    id: 'q12',
    section: 'aspirations',
    question: 'The kind of difference I want to make:',
    options: [
      { value: 'R', label: 'Build infrastructure and solve technical problems' },
      { value: 'I', label: 'Discover new knowledge and push science forward' },
      { value: 'A', label: 'Create art and culture that moves people' },
      { value: 'S', label: 'Help individuals and communities grow' },
      { value: 'E', label: 'Create jobs and grow the economy' },
      { value: 'C', label: 'Keep systems running smoothly and efficiently' },
    ],
  },
  {
    id: 'q13',
    section: 'subjects',
    question: 'If I could study one extra subject it would be:',
    options: [
      { value: 'R', label: 'Robotics or Engineering Drawing' },
      { value: 'I', label: 'Advanced Mathematics or Astronomy' },
      { value: 'A', label: 'Graphic Design or Creative Writing' },
      { value: 'S', label: 'Psychology or Sociology' },
      { value: 'E', label: 'Business Studies or Marketing' },
      { value: 'C', label: 'Statistics or Information Technology' },
    ],
  },
  {
    id: 'q14',
    section: 'subjects',
    question: 'The activity I find most energising is:',
    options: [
      { value: 'R', label: 'Sports, experiments, or making things' },
      { value: 'I', label: 'Solving puzzles, maths, or coding' },
      { value: 'A', label: 'Painting, writing stories, or performing' },
      { value: 'S', label: 'Volunteering, debating, or group activities' },
      { value: 'E', label: 'Starting projects and motivating others' },
      { value: 'C', label: 'Planning schedules and keeping notes organised' },
    ],
  },
  {
    id: 'q15',
    section: 'subjects',
    question: 'When I learn something new I prefer:',
    options: [
      { value: 'R', label: 'Hands-on demonstrations and experiments' },
      { value: 'I', label: 'Reading, research, and deep understanding' },
      { value: 'A', label: 'Visual examples, stories, and creativity' },
      { value: 'S', label: 'Group discussions and sharing ideas' },
      { value: 'E', label: 'Case studies and real-world scenarios' },
      { value: 'C', label: 'Clear notes, structure, and repetition' },
    ],
  },
];
