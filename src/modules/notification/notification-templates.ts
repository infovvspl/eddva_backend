export interface TemplatePayload {
  streak?: number;
  fullName?: string;
  topicName?: string;
  subjectName?: string;
  challengerName?: string;
  rivalName?: string;
  examTarget?: 'JEE' | 'NEET' | string;
}

export interface NotificationContent {
  title: string;
  body: string;
}

export const STREAK_TEMPLATES: NotificationContent[] = [
  {
    title: 'Your study streak is packing its bags... 💼🎒',
    body: "It says you don't love it anymore. Solve 1 quick battle to save your {streak}-day streak! 😭🔥",
  },
  {
    title: "Don't let the flame die! 🚂",
    body: "Your {streak}-day streak is in danger of resetting tonight. Alakh Sir says: 'Consistency beats talent.' Solve a DPP now! 📚",
  },
  {
    title: '11:00 PM: Tick-Tock... ⏰',
    body: 'Just a short time left to save your {streak}-day streak! Keep the momentum alive. 🔥',
  },
  {
    title: 'Streak check! 🚨',
    body: "Don't let your {streak}-day streak turn to ashes. One battle. 5 minutes. Save the flame! 🔥",
  },
];

export const MORNING_TEMPLATES: Record<string, NotificationContent[]> = {
  PHYSICS: [
    {
      title: "Newton didn't sleep in! 🍎⏰",
      body: "He was busy discovering gravity. You just need to discover today's Study Plan. Let's go!",
    },
    {
      title: 'Warning: High potential energy detected ⚡',
      body: 'Convert that potential energy into kinetic energy today! Start your physics study plan now.',
    },
  ],
  CHEMISTRY: [
    {
      title: 'Got chemistry today? 🧪',
      body: "Let's build a covalent bond with your study plan. Solve Organic Chemistry battles now!",
    },
    {
      title: 'Are you a catalyst? ⚗️',
      body: "Because you accelerate your own success when you study. Let's get chemical today!",
    },
  ],
  MATHEMATICS: [
    {
      title: "Let's integrate study into your limit! 📈",
      body: 'No derivative thoughts today. Check your daily plan and increase your ELO rating!',
    },
    {
      title: 'Solve for X (where X is success) 📐',
      body: "Equation of the day: consistency + practice = IIT Bombay. Let's start math prep!",
    },
  ],
  BIOLOGY: [
    {
      title: 'Mitochondria is the powerhouse of the cell... ⚡',
      body: 'And APEXIQ is the powerhouse of your NEET prep. Wake up and start your daily biology quiz!',
    },
    {
      title: 'Time for photosynthesis! 🌿☀️',
      body: 'Soak up the knowledge early in the morning. Your biology study plan is active!',
    },
  ],
  GENERAL: [
    {
      title: 'Good morning! 🌅',
      body: "Your study plan is ready. Let's go!",
    },
    {
      title: 'Rise and grind! 🚀',
      body: "Another day to get closer to your dream rank. Let's check today's target chapters!",
    },
  ],
};

export const BATTLE_REMINDER_TEMPLATES: NotificationContent[] = [
  {
    title: 'Daily battle starts in 15 minutes ⚔️',
    body: 'Join the arena and protect your rank.',
  },
  {
    title: 'Arena is heating up! 🔥⚔️',
    body: 'Daily battle starts in 15 mins. Prepare your formulas and defeat your opponents!',
  },
  {
    title: 'Rumble in the learning arena! 🥊',
    body: 'Students are joining for the 7:00 PM battle. Get in before matching ends!',
  },
];

export const BATTLE_CHALLENGE_TEMPLATES: NotificationContent[] = [
  {
    title: 'Whoops! Challenge incoming 🥊',
    body: '{challengerName} just threw down the gauntlet in {topicName}! Do you have the ELO to back it up or are you running? 😉',
  },
  {
    title: 'A wild opponent appears! ⚔️',
    body: '{challengerName} has challenged you to a quick duel in {topicName}. Accept now!',
  },
];

export const TIER_UP_TEMPLATES: NotificationContent[] = [
  {
    title: 'Bronze Tier is calling! 🏆',
    body: 'You are just 1 win away from upgrading your Elo Tier! Enter the arena and claim your glory. ⚔️',
  },
  {
    title: 'Rank Upgrade pending... 📈',
    body: 'Your ELO is peaking! Play 1 more battle and secure your next ELO tier.',
  },
];

export const OVERTAKE_TEMPLATES: NotificationContent[] = [
  {
    title: 'Someone stole your crown! 👑',
    body: '{rivalName} just overtook you on the weekly leaderboard. Go fight a battle to win back your rank!',
  },
  {
    title: 'Leaderboard Alert! 📈',
    body: 'Oh no! {rivalName} just pushed you down one rank. Reclaim your spot in the next 10 minutes.',
  },
];

export function getTemplate(
  category: 'streak' | 'morning' | 'battle_reminder' | 'battle_challenge' | 'tier_up' | 'overtake',
  payload: TemplatePayload,
): NotificationContent {
  let list: NotificationContent[] = [];

  switch (category) {
    case 'streak':
      list = STREAK_TEMPLATES;
      break;
    case 'battle_reminder':
      list = BATTLE_REMINDER_TEMPLATES;
      break;
    case 'battle_challenge':
      list = BATTLE_CHALLENGE_TEMPLATES;
      break;
    case 'tier_up':
      list = TIER_UP_TEMPLATES;
      break;
    case 'overtake':
      list = OVERTAKE_TEMPLATES;
      break;
    case 'morning':
    default:
      // Select morning based on exam target or randomly
      const isNeet = payload.examTarget?.toUpperCase() === 'NEET';
      const availableSubjects = isNeet
        ? ['PHYSICS', 'CHEMISTRY', 'BIOLOGY']
        : ['PHYSICS', 'CHEMISTRY', 'MATHEMATICS'];

      const randomSubject = availableSubjects[Math.floor(Math.random() * availableSubjects.length)];
      list = MORNING_TEMPLATES[randomSubject] || MORNING_TEMPLATES.GENERAL;
      break;
  }

  if (!list || list.length === 0) {
    list = MORNING_TEMPLATES.GENERAL;
  }

  // Pick a random template from the list
  const idx = Math.floor(Math.random() * list.length);
  const template = list[idx];

  // Helper to replace placeholders
  let title = template.title;
  let body = template.body;

  const replacements: Record<string, string> = {
    '{streak}': String(payload.streak ?? 0),
    '{fullName}': payload.fullName ?? 'Student',
    '{topicName}': payload.topicName ?? 'General Topic',
    '{subjectName}': payload.subjectName ?? 'General Subject',
    '{challengerName}': payload.challengerName ?? 'Another player',
    '{rivalName}': payload.rivalName ?? 'A competitor',
  };

  for (const [placeholder, val] of Object.entries(replacements)) {
    title = title.replace(new RegExp(placeholder, 'g'), val);
    body = body.replace(new RegExp(placeholder, 'g'), val);
  }

  return { title, body };
}
