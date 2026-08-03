export interface AchievementDefinition {
  id: string;
  title: string;
  category: 'QUIZ_RUSH' | 'MATH_SPRINT' | 'MEMORY_MATCH' | 'WORD_MASTER' | 'TREASURE_HUNT' | 'ARCADE_OVERALL';
  description: string;
  icon: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | 'MYTHIC';
  criteria_type: string;
  criteria_target: number;
  reward_xp: number;
  reward_coins: number;
}

export const SEED_ACHIEVEMENTS: AchievementDefinition[] = [
  // 🎮 1. QUIZ RUSH (8)
  { id: 'qr_1', title: 'First Quiz', category: 'QUIZ_RUSH', description: 'Play your first Quiz Rush game', icon: '⚡', tier: 'BRONZE', criteria_type: 'QUIZ_RUSH_PLAY', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'qr_2', title: 'Speed Solver', category: 'QUIZ_RUSH', description: 'Score 100+ points in Quiz Rush', icon: '⏱️', tier: 'BRONZE', criteria_type: 'QUIZ_RUSH_SCORE', criteria_target: 100, reward_xp: 75, reward_coins: 10 },
  { id: 'qr_3', title: 'Quiz Streak', category: 'QUIZ_RUSH', description: 'Achieve a 5-question streak in Quiz Rush', icon: '🔥', tier: 'SILVER', criteria_type: 'QUIZ_RUSH_STREAK', criteria_target: 5, reward_xp: 150, reward_coins: 20 },
  { id: 'qr_4', title: 'Perfect Score', category: 'QUIZ_RUSH', description: 'Score 100% accuracy in a Quiz Rush session', icon: '🎯', tier: 'SILVER', criteria_type: 'QUIZ_RUSH_PERFECT', criteria_target: 1, reward_xp: 200, reward_coins: 25 },
  { id: 'qr_5', title: 'Quiz Champion', category: 'QUIZ_RUSH', description: 'Play 15 Quiz Rush games', icon: '🏆', tier: 'GOLD', criteria_type: 'QUIZ_RUSH_PLAY', criteria_target: 15, reward_xp: 350, reward_coins: 50 },
  { id: 'qr_6', title: 'Lightning Brain', category: 'QUIZ_RUSH', description: 'Score 300+ points in Quiz Rush', icon: '🚀', tier: 'PLATINUM', criteria_type: 'QUIZ_RUSH_SCORE', criteria_target: 300, reward_xp: 600, reward_coins: 100 },
  { id: 'qr_7', title: 'Quiz Legend', category: 'QUIZ_RUSH', description: 'Play 50 Quiz Rush games', icon: '🌟', tier: 'DIAMOND', criteria_type: 'QUIZ_RUSH_PLAY', criteria_target: 50, reward_xp: 1200, reward_coins: 250 },
  { id: 'qr_8', title: 'Ultimate Quiz Master', category: 'QUIZ_RUSH', description: 'Score 500+ points with 10-streak in Quiz Rush', icon: '👑', tier: 'MYTHIC', criteria_type: 'QUIZ_RUSH_SCORE', criteria_target: 500, reward_xp: 2500, reward_coins: 500 },

  // 🚀 2. MATH SPRINT (8)
  { id: 'ms_1', title: 'Number Ninja', category: 'MATH_SPRINT', description: 'Play your first Math Sprint game', icon: '🥷', tier: 'BRONZE', criteria_type: 'MATH_SPRINT_PLAY', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'ms_2', title: 'Fast Calculator', category: 'MATH_SPRINT', description: 'Solve 10 math problems correctly', icon: '🔢', tier: 'BRONZE', criteria_type: 'MATH_SPRINT_CORRECT', criteria_target: 10, reward_xp: 75, reward_coins: 10 },
  { id: 'ms_3', title: 'Equation Expert', category: 'MATH_SPRINT', description: 'Score 200+ points in Math Sprint', icon: '📐', tier: 'SILVER', criteria_type: 'MATH_SPRINT_SCORE', criteria_target: 200, reward_xp: 150, reward_coins: 20 },
  { id: 'ms_4', title: 'Speed Mathematician', category: 'MATH_SPRINT', description: 'Play 10 Math Sprint games', icon: '🏎️', tier: 'SILVER', criteria_type: 'MATH_SPRINT_PLAY', criteria_target: 10, reward_xp: 200, reward_coins: 25 },
  { id: 'ms_5', title: 'Math Genius', category: 'MATH_SPRINT', description: 'Solve 50 math problems correctly', icon: '🧠', tier: 'GOLD', criteria_type: 'MATH_SPRINT_CORRECT', criteria_target: 50, reward_xp: 350, reward_coins: 50 },
  { id: 'ms_6', title: 'Sprint Champion', category: 'MATH_SPRINT', description: 'Score 500+ points in Math Sprint', icon: '🏆', tier: 'PLATINUM', criteria_type: 'MATH_SPRINT_SCORE', criteria_target: 500, reward_xp: 600, reward_coins: 100 },
  { id: 'ms_7', title: 'Formula Master', category: 'MATH_SPRINT', description: 'Solve 150 math problems in Math Sprint', icon: '🧙‍♂️', tier: 'DIAMOND', criteria_type: 'MATH_SPRINT_CORRECT', criteria_target: 150, reward_xp: 1200, reward_coins: 250 },
  { id: 'ms_8', title: 'Infinity Calculator', category: 'MATH_SPRINT', description: 'Score 1000+ points in Math Sprint', icon: '♾️', tier: 'MYTHIC', criteria_type: 'MATH_SPRINT_SCORE', criteria_target: 1000, reward_xp: 2500, reward_coins: 500 },

  // 🧠 3. MEMORY MATCH (8)
  { id: 'mm_1', title: 'Memory Rookie', category: 'MEMORY_MATCH', description: 'Play your first Memory Match game', icon: '📇', tier: 'BRONZE', criteria_type: 'MEMORY_MATCH_PLAY', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'mm_2', title: 'Pattern Finder', category: 'MEMORY_MATCH', description: 'Complete a Memory Match deck', icon: '🧩', tier: 'BRONZE', criteria_type: 'MEMORY_MATCH_CLEAR', criteria_target: 1, reward_xp: 75, reward_coins: 10 },
  { id: 'mm_3', title: 'Sharp Memory', category: 'MEMORY_MATCH', description: 'Finish a Memory Match game in under 60 seconds', icon: '⏱️', tier: 'SILVER', criteria_type: 'MEMORY_MATCH_TIME', criteria_target: 60, reward_xp: 150, reward_coins: 20 },
  { id: 'mm_4', title: 'Perfect Recall', category: 'MEMORY_MATCH', description: 'Complete a Memory Match deck with zero wrong turns', icon: '🎯', tier: 'SILVER', criteria_type: 'MEMORY_MATCH_PERFECT', criteria_target: 1, reward_xp: 200, reward_coins: 25 },
  { id: 'mm_5', title: 'Memory Wizard', category: 'MEMORY_MATCH', description: 'Complete 5 Memory Match decks', icon: '🧙‍♂️', tier: 'GOLD', criteria_type: 'MEMORY_MATCH_CLEAR', criteria_target: 5, reward_xp: 350, reward_coins: 50 },
  { id: 'mm_6', title: 'Brain Master', category: 'MEMORY_MATCH', description: 'Finish a Memory Match game in under 35 seconds', icon: '🧠', tier: 'PLATINUM', criteria_type: 'MEMORY_MATCH_TIME', criteria_target: 35, reward_xp: 600, reward_coins: 100 },
  { id: 'mm_7', title: 'Recall Champion', category: 'MEMORY_MATCH', description: 'Play 30 Memory Match games', icon: '🏆', tier: 'DIAMOND', criteria_type: 'MEMORY_MATCH_PLAY', criteria_target: 30, reward_xp: 1200, reward_coins: 250 },
  { id: 'mm_8', title: 'Memory Legend', category: 'MEMORY_MATCH', description: 'Finish a Memory Match game in under 20 seconds', icon: '💎', tier: 'MYTHIC', criteria_type: 'MEMORY_MATCH_TIME', criteria_target: 20, reward_xp: 2500, reward_coins: 500 },

  // 📖 4. WORD MASTER (8)
  { id: 'wm_1', title: 'Vocabulary Builder', category: 'WORD_MASTER', description: 'Play your first Word Master game', icon: '🔤', tier: 'BRONZE', criteria_type: 'WORD_MASTER_PLAY', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'wm_2', title: 'Spelling Star', category: 'WORD_MASTER', description: 'Solve 5 words correctly in Word Master', icon: '⭐', tier: 'BRONZE', criteria_type: 'WORD_MASTER_CORRECT', criteria_target: 5, reward_xp: 75, reward_coins: 10 },
  { id: 'wm_3', title: 'Word Hunter', category: 'WORD_MASTER', description: 'Score 200+ points in Word Master', icon: '🏹', tier: 'SILVER', criteria_type: 'WORD_MASTER_SCORE', criteria_target: 200, reward_xp: 150, reward_coins: 20 },
  { id: 'wm_4', title: 'Grammar Guru', category: 'WORD_MASTER', description: 'Play 10 Word Master games', icon: '📖', tier: 'SILVER', criteria_type: 'WORD_MASTER_PLAY', criteria_target: 10, reward_xp: 200, reward_coins: 25 },
  { id: 'wm_5', title: 'Dictionary Master', category: 'WORD_MASTER', description: 'Solve 25 words correctly in Word Master', icon: '🏛️', tier: 'GOLD', criteria_type: 'WORD_MASTER_CORRECT', criteria_target: 25, reward_xp: 350, reward_coins: 50 },
  { id: 'wm_6', title: 'Language Wizard', category: 'WORD_MASTER', description: 'Score 500+ points in Word Master', icon: '🧙‍♂️', tier: 'PLATINUM', criteria_type: 'WORD_MASTER_SCORE', criteria_target: 500, reward_xp: 600, reward_coins: 100 },
  { id: 'wm_7', title: 'Word Champion', category: 'WORD_MASTER', description: 'Solve 100 words correctly in Word Master', icon: '🏆', tier: 'DIAMOND', criteria_type: 'WORD_MASTER_CORRECT', criteria_target: 100, reward_xp: 1200, reward_coins: 250 },
  { id: 'wm_8', title: 'Word Legend', category: 'WORD_MASTER', description: 'Score 1000+ points in Word Master', icon: '👑', tier: 'MYTHIC', criteria_type: 'WORD_MASTER_SCORE', criteria_target: 1000, reward_xp: 2500, reward_coins: 500 },

  // 🗺️ 5. TREASURE HUNT (8)
  { id: 'th_1', title: 'Explorer', category: 'TREASURE_HUNT', description: 'Complete your first Treasure Hunt stage', icon: '🧭', tier: 'BRONZE', criteria_type: 'TREASURE_PLAY', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'th_2', title: 'Treasure Seeker', category: 'TREASURE_HUNT', description: 'Clear 3 stages in Treasure Hunt', icon: '🔍', tier: 'BRONZE', criteria_type: 'TREASURE_STAGES', criteria_target: 3, reward_xp: 75, reward_coins: 10 },
  { id: 'th_3', title: 'Map Reader', category: 'TREASURE_HUNT', description: 'Earn 500+ score in Treasure Hunt', icon: '🗺️', tier: 'SILVER', criteria_type: 'TREASURE_SCORE', criteria_target: 500, reward_xp: 150, reward_coins: 20 },
  { id: 'th_4', title: 'Hidden Finder', category: 'TREASURE_HUNT', description: 'Clear 10 stages in Treasure Hunt', icon: '🏝️', tier: 'SILVER', criteria_type: 'TREASURE_STAGES', criteria_target: 10, reward_xp: 250, reward_coins: 30 },
  { id: 'th_5', title: 'Gold Collector', category: 'TREASURE_HUNT', description: 'Earn 1000+ score in Treasure Hunt', icon: '🪙', tier: 'GOLD', criteria_type: 'TREASURE_SCORE', criteria_target: 1000, reward_xp: 400, reward_coins: 60 },
  { id: 'th_6', title: 'Treasure Master', category: 'TREASURE_HUNT', description: 'Clear 25 stages in Treasure Hunt', icon: '🗝️', tier: 'PLATINUM', criteria_type: 'TREASURE_STAGES', criteria_target: 25, reward_xp: 750, reward_coins: 120 },
  { id: 'th_7', title: 'Adventure Hero', category: 'TREASURE_HUNT', description: 'Clear 50 stages in Treasure Hunt', icon: '🗡️', tier: 'DIAMOND', criteria_type: 'TREASURE_STAGES', criteria_target: 50, reward_xp: 1500, reward_coins: 300 },
  { id: 'th_8', title: 'Treasure Legend', category: 'TREASURE_HUNT', description: 'Clear 100 stages in Treasure Hunt', icon: '👑', tier: 'MYTHIC', criteria_type: 'TREASURE_STAGES', criteria_target: 100, reward_xp: 3000, reward_coins: 600 },

  // 🏆 6. ARCADE OVERALL (8)
  { id: 'ao_1', title: 'Casual Gamer', category: 'ARCADE_OVERALL', description: 'Play any 3 Arcade games', icon: '🕹️', tier: 'BRONZE', criteria_type: 'TOTAL_GAMES', criteria_target: 3, reward_xp: 50, reward_coins: 5 },
  { id: 'ao_2', title: 'Rising Star', category: 'ARCADE_OVERALL', description: 'Play at least 3 different game types', icon: '⭐', tier: 'BRONZE', criteria_type: 'DISTINCT_GAMES', criteria_target: 3, reward_xp: 100, reward_coins: 15 },
  { id: 'ao_3', title: 'Daily Player', category: 'ARCADE_OVERALL', description: 'Play 15 Arcade games', icon: '📅', tier: 'SILVER', criteria_type: 'TOTAL_GAMES', criteria_target: 15, reward_xp: 200, reward_coins: 30 },
  { id: 'ao_4', title: 'Weekly Streak', category: 'ARCADE_OVERALL', description: 'Play all 5 Arcade game types', icon: '🔥', tier: 'SILVER', criteria_type: 'DISTINCT_GAMES', criteria_target: 5, reward_xp: 350, reward_coins: 50 },
  { id: 'ao_5', title: 'Elite Gamer', category: 'ARCADE_OVERALL', description: 'Play 50 Arcade games', icon: '🎖️', tier: 'GOLD', criteria_type: 'TOTAL_GAMES', criteria_target: 50, reward_xp: 600, reward_coins: 100 },
  { id: 'ao_6', title: 'Master Collector', category: 'ARCADE_OVERALL', description: 'Score 100% accuracy in 10 Arcade games', icon: '💎', tier: 'PLATINUM', criteria_type: 'PERFECT_GAMES', criteria_target: 10, reward_xp: 800, reward_coins: 150 },
  { id: 'ao_7', title: 'Hall of Fame', category: 'ARCADE_OVERALL', description: 'Play 100 Arcade games', icon: '🏛️', tier: 'DIAMOND', criteria_type: 'TOTAL_GAMES', criteria_target: 100, reward_xp: 1500, reward_coins: 300 },
  { id: 'ao_8', title: 'Ultimate Legend', category: 'ARCADE_OVERALL', description: 'Earn 5000+ total XP from Arcade games', icon: '👑', tier: 'MYTHIC', criteria_type: 'TOTAL_GAME_XP', criteria_target: 5000, reward_xp: 3500, reward_coins: 700 },
];
