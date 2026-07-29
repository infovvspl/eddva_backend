export interface AchievementDefinition {
  id: string;
  title: string;
  category: 'LEARNING' | 'ATTENDANCE' | 'GAMES' | 'BATTLES' | 'REVISION' | 'ASSIGNMENTS' | 'COMPETITIONS';
  description: string;
  icon: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | 'MYTHIC';
  criteria_type: string;
  criteria_target: number;
  reward_xp: number;
  reward_coins: number;
}

export const SEED_ACHIEVEMENTS: AchievementDefinition[] = [
  // 1. LEARNING (15)
  { id: 'learn_1', title: 'First Step', category: 'LEARNING', description: 'Watch your first video lesson', icon: '📺', tier: 'BRONZE', criteria_type: 'VIDEO_WATCH', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'learn_2', title: 'Knowledge Seeker', category: 'LEARNING', description: 'Watch 10 video lessons', icon: '📚', tier: 'SILVER', criteria_type: 'VIDEO_WATCH', criteria_target: 10, reward_xp: 150, reward_coins: 20 },
  { id: 'learn_3', title: 'Curious Mind', category: 'LEARNING', description: 'Watch 25 video lessons', icon: '🧠', tier: 'GOLD', criteria_type: 'VIDEO_WATCH', criteria_target: 25, reward_xp: 300, reward_coins: 50 },
  { id: 'learn_4', title: 'Scholar Athlete', category: 'LEARNING', description: 'Watch 50 video lessons', icon: '🎓', tier: 'PLATINUM', criteria_type: 'VIDEO_WATCH', criteria_target: 50, reward_xp: 600, reward_coins: 100 },
  { id: 'learn_5', title: 'Master of Video Modules', category: 'LEARNING', description: 'Watch 100 video lessons', icon: '👑', tier: 'DIAMOND', criteria_type: 'VIDEO_WATCH', criteria_target: 100, reward_xp: 1200, reward_coins: 250 },

  { id: 'learn_6', title: 'Quiz Starter', category: 'LEARNING', description: 'Complete 1 topic quiz', icon: '📝', tier: 'BRONZE', criteria_type: 'QUIZ_COMPLETE', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'learn_7', title: 'Quiz Enthusiast', category: 'LEARNING', description: 'Complete 10 topic quizzes', icon: '🎯', tier: 'SILVER', criteria_type: 'QUIZ_COMPLETE', criteria_target: 10, reward_xp: 200, reward_coins: 25 },
  { id: 'learn_8', title: 'Sharpshooter', category: 'LEARNING', description: 'Score 100% on any quiz', icon: '⚡', tier: 'GOLD', criteria_type: 'PERFECT_QUIZ', criteria_target: 1, reward_xp: 250, reward_coins: 40 },
  { id: 'learn_9', title: 'Flawless Academic', category: 'LEARNING', description: 'Score 100% on 5 quizzes', icon: '🌟', tier: 'PLATINUM', criteria_type: 'PERFECT_QUIZ', criteria_target: 5, reward_xp: 500, reward_coins: 90 },
  { id: 'learn_10', title: 'Grandmaster Scholar', category: 'LEARNING', description: 'Score 100% on 15 quizzes', icon: '💎', tier: 'DIAMOND', criteria_type: 'PERFECT_QUIZ', criteria_target: 15, reward_xp: 1500, reward_coins: 300 },

  { id: 'learn_11', title: 'Subject Explorer', category: 'LEARNING', description: 'Complete topics in 3 different subjects', icon: '🗺️', tier: 'BRONZE', criteria_type: 'SUBJECT_EXPLORE', criteria_target: 3, reward_xp: 100, reward_coins: 10 },
  { id: 'learn_12', title: 'Polymath', category: 'LEARNING', description: 'Complete topics in 5 different subjects', icon: '🏛️', tier: 'SILVER', criteria_type: 'SUBJECT_EXPLORE', criteria_target: 5, reward_xp: 250, reward_coins: 30 },
  { id: 'learn_13', title: 'Subject Champion', category: 'LEARNING', description: 'Complete all modules in 1 subject', icon: '🏆', tier: 'GOLD', criteria_type: 'SUBJECT_COMPLETE', criteria_target: 1, reward_xp: 500, reward_coins: 80 },
  { id: 'learn_14', title: 'Academic Titan', category: 'LEARNING', description: 'Complete all modules in 3 subjects', icon: '🥇', tier: 'PLATINUM', criteria_type: 'SUBJECT_COMPLETE', criteria_target: 3, reward_xp: 1000, reward_coins: 200 },
  { id: 'learn_15', title: 'Omniscient Prodigy', category: 'LEARNING', description: 'Reach Level 10 in Gamification', icon: '🌠', tier: 'MYTHIC', criteria_type: 'REACH_LEVEL', criteria_target: 10, reward_xp: 2500, reward_coins: 500 },

  // 2. ATTENDANCE & STREAKS (15)
  { id: 'att_1', title: 'Day One', category: 'ATTENDANCE', description: 'Log in and study for 1 day', icon: '📅', tier: 'BRONZE', criteria_type: 'STREAK_DAYS', criteria_target: 1, reward_xp: 30, reward_coins: 5 },
  { id: 'att_2', title: 'Hat Trick', category: 'ATTENDANCE', description: 'Maintain a 3-day study streak', icon: '🔥', tier: 'BRONZE', criteria_type: 'STREAK_DAYS', criteria_target: 3, reward_xp: 100, reward_coins: 15 },
  { id: 'att_3', title: 'Weekly Warrior', category: 'ATTENDANCE', description: 'Maintain a 7-day study streak', icon: '⚡', tier: 'SILVER', criteria_type: 'STREAK_DAYS', criteria_target: 7, reward_xp: 250, reward_coins: 40 },
  { id: 'att_4', title: 'Fortnight Champion', category: 'ATTENDANCE', description: 'Maintain a 14-day study streak', icon: '🚀', tier: 'GOLD', criteria_type: 'STREAK_DAYS', criteria_target: 14, reward_xp: 500, reward_coins: 80 },
  { id: 'att_5', title: 'Monthly Titan', category: 'ATTENDANCE', description: 'Maintain a 30-day study streak', icon: '💥', tier: 'PLATINUM', criteria_type: 'STREAK_DAYS', criteria_target: 30, reward_xp: 1200, reward_coins: 200 },
  { id: 'att_6', title: 'Unstoppable Legend', category: 'ATTENDANCE', description: 'Maintain a 60-day study streak', icon: '👑', tier: 'DIAMOND', criteria_type: 'STREAK_DAYS', criteria_target: 60, reward_xp: 2500, reward_coins: 500 },
  { id: 'att_7', title: 'Eternal Flame', category: 'ATTENDANCE', description: 'Maintain a 100-day study streak', icon: '🌌', tier: 'MYTHIC', criteria_type: 'STREAK_DAYS', criteria_target: 100, reward_xp: 5000, reward_coins: 1000 },

  { id: 'att_8', title: 'Punctual Learner', category: 'ATTENDANCE', description: 'Attend live class on time', icon: '⏰', tier: 'BRONZE', criteria_type: 'LIVE_CLASS_ATTEND', criteria_target: 1, reward_xp: 40, reward_coins: 5 },
  { id: 'att_9', title: 'Class Regular', category: 'ATTENDANCE', description: 'Attend 5 live classes', icon: '👨‍🏫', tier: 'SILVER', criteria_type: 'LIVE_CLASS_ATTEND', criteria_target: 5, reward_xp: 150, reward_coins: 20 },
  { id: 'att_10', title: 'Dedicated Student', category: 'ATTENDANCE', description: 'Attend 15 live classes', icon: '🎓', tier: 'GOLD', criteria_type: 'LIVE_CLASS_ATTEND', criteria_target: 15, reward_xp: 350, reward_coins: 50 },
  { id: 'att_11', title: 'Front Row Star', category: 'ATTENDANCE', description: 'Attend 30 live classes', icon: '✨', tier: 'PLATINUM', criteria_type: 'LIVE_CLASS_ATTEND', criteria_target: 30, reward_xp: 750, reward_coins: 120 },
  { id: 'att_12', title: 'Classroom Legend', category: 'ATTENDANCE', description: 'Attend 60 live classes', icon: '🌟', tier: 'DIAMOND', criteria_type: 'LIVE_CLASS_ATTEND', criteria_target: 60, reward_xp: 1500, reward_coins: 300 },

  { id: 'att_13', title: 'Night Owl', category: 'ATTENDANCE', description: 'Complete a study session after 9 PM', icon: '🦉', tier: 'BRONZE', criteria_type: 'STUDY_NIGHT', criteria_target: 1, reward_xp: 50, reward_coins: 10 },
  { id: 'att_14', title: 'Early Bird', category: 'ATTENDANCE', description: 'Complete a study session before 7 AM', icon: '🌅', tier: 'BRONZE', criteria_type: 'STUDY_EARLY', criteria_target: 1, reward_xp: 50, reward_coins: 10 },
  { id: 'att_15', title: 'Weekend Hustler', category: 'ATTENDANCE', description: 'Study on both Saturday and Sunday', icon: '🏋️', tier: 'SILVER', criteria_type: 'STUDY_WEEKEND', criteria_target: 1, reward_xp: 100, reward_coins: 15 },

  // 3. GAMES & ARCADE (15)
  { id: 'game_1', title: 'Arcade Rookie', category: 'GAMES', description: 'Play your first Learning Arcade game', icon: '🕹️', tier: 'BRONZE', criteria_type: 'GAME_PLAY', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'game_2', title: 'Quiz Rush Winner', category: 'GAMES', description: 'Win a Quiz Rush game', icon: '⚡', tier: 'BRONZE', criteria_type: 'QUIZ_RUSH_WIN', criteria_target: 1, reward_xp: 75, reward_coins: 10 },
  { id: 'game_3', title: 'Math Speed Demon', category: 'GAMES', description: 'Score > 500 in Math Sprint', icon: '🚀', tier: 'SILVER', criteria_type: 'MATH_SPRINT_HIGH', criteria_target: 500, reward_xp: 150, reward_coins: 20 },
  { id: 'game_4', title: 'Memory Mastermind', category: 'GAMES', description: 'Complete Memory Match in under 40 seconds', icon: '🧠', tier: 'SILVER', criteria_type: 'MEMORY_MATCH_SPEED', criteria_target: 40, reward_xp: 150, reward_coins: 20 },
  { id: 'game_5', title: 'Word Wizard', category: 'GAMES', description: 'Guess all words correctly in Word Master', icon: '🔤', tier: 'SILVER', criteria_type: 'WORD_MASTER_PERFECT', criteria_target: 1, reward_xp: 150, reward_coins: 20 },
  { id: 'game_6', title: 'Treasure Explorer', category: 'GAMES', description: 'Complete 3 maps in Treasure Hunt', icon: '🗺️', tier: 'GOLD', criteria_type: 'TREASURE_MAPS', criteria_target: 3, reward_xp: 300, reward_coins: 40 },
  { id: 'game_7', title: 'Arcade Enthusiast', category: 'GAMES', description: 'Play 25 Arcade games', icon: '🎮', tier: 'GOLD', criteria_type: 'GAME_PLAY', criteria_target: 25, reward_xp: 400, reward_coins: 60 },
  { id: 'game_8', title: 'HighScore Slayer', category: 'GAMES', description: 'Set a new global personal high score', icon: '🎯', tier: 'PLATINUM', criteria_type: 'PERSONAL_RECORD', criteria_target: 1, reward_xp: 500, reward_coins: 100 },
  { id: 'game_9', title: 'Arcade Dominator', category: 'GAMES', description: 'Play 100 Arcade games', icon: '👑', tier: 'DIAMOND', criteria_type: 'GAME_PLAY', criteria_target: 100, reward_xp: 1500, reward_coins: 300 },
  { id: 'game_10', title: 'Untouchable Champion', category: 'GAMES', description: 'Win 50 Arcade games with >90% accuracy', icon: '🏆', tier: 'MYTHIC', criteria_type: 'HIGH_ACCURACY_GAMES', criteria_target: 50, reward_xp: 3000, reward_coins: 600 },

  { id: 'game_11', title: 'Lightning Fast', category: 'GAMES', description: 'Answer a question in less than 2 seconds', icon: '⚡', tier: 'BRONZE', criteria_type: 'FAST_ANSWER', criteria_target: 2, reward_xp: 60, reward_coins: 10 },
  { id: 'game_12', title: 'Precision Shooter', category: 'GAMES', description: 'Get 10 correct answers in a row in Quiz Rush', icon: '🎯', tier: 'SILVER', criteria_type: 'ANSWER_STREAK', criteria_target: 10, reward_xp: 150, reward_coins: 25 },
  { id: 'game_13', title: 'Math Genius', category: 'GAMES', description: 'Solve 50 math sprint problems', icon: '📐', tier: 'GOLD', criteria_type: 'MATH_PROBLEMS', criteria_target: 50, reward_xp: 300, reward_coins: 50 },
  { id: 'game_14', title: 'Vocabulary King', category: 'GAMES', description: 'Solve 50 word master puzzles', icon: '📖', tier: 'PLATINUM', criteria_type: 'WORD_PUZZLES', criteria_target: 50, reward_xp: 600, reward_coins: 100 },
  { id: 'game_15', title: 'Arcade God', category: 'GAMES', description: 'Achieve #1 rank on any Arcade Leaderboard', icon: '🏅', tier: 'MYTHIC', criteria_type: 'RANK_ONE', criteria_target: 1, reward_xp: 2000, reward_coins: 400 },

  // 4. BATTLES & ARENAS (15)
  { id: 'bat_1', title: 'First Blood', category: 'BATTLES', description: 'Participate in your first Battle Arena duel', icon: '⚔️', tier: 'BRONZE', criteria_type: 'BATTLE_PARTICIPATE', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'bat_2', title: 'Victorious Duelist', category: 'BATTLES', description: 'Win 1 Battle Arena match', icon: '🛡️', tier: 'BRONZE', criteria_type: 'BATTLE_WIN', criteria_target: 1, reward_xp: 100, reward_coins: 15 },
  { id: 'bat_3', title: 'Arena Contender', category: 'BATTLES', description: 'Win 5 Battle Arena matches', icon: '🗡️', tier: 'SILVER', criteria_type: 'BATTLE_WIN', criteria_target: 5, reward_xp: 250, reward_coins: 40 },
  { id: 'bat_4', title: 'Battle Strategist', category: 'BATTLES', description: 'Win 15 Battle Arena matches', icon: '🏹', tier: 'GOLD', criteria_type: 'BATTLE_WIN', criteria_target: 15, reward_xp: 500, reward_coins: 90 },
  { id: 'bat_5', title: 'Gladiator', category: 'BATTLES', description: 'Win 30 Battle Arena matches', icon: '⚜️', tier: 'PLATINUM', criteria_type: 'BATTLE_WIN', criteria_target: 30, reward_xp: 1000, reward_coins: 200 },
  { id: 'bat_6', title: 'Arena Warlord', category: 'BATTLES', description: 'Win 75 Battle Arena matches', icon: '👑', tier: 'DIAMOND', criteria_type: 'BATTLE_WIN', criteria_target: 75, reward_xp: 2500, reward_coins: 500 },
  { id: 'bat_7', title: 'Undefeated Champion', category: 'BATTLES', description: 'Maintain a 10-match battle win streak', icon: '🔥', tier: 'MYTHIC', criteria_type: 'BATTLE_WIN_STREAK', criteria_target: 10, reward_xp: 4000, reward_coins: 800 },

  { id: 'bat_8', title: 'Quick Strike', category: 'BATTLES', description: 'Score a critical hit in Battle Arena', icon: '💥', tier: 'BRONZE', criteria_type: 'BATTLE_CRITICAL', criteria_target: 1, reward_xp: 50, reward_coins: 10 },
  { id: 'bat_9', title: 'Flawless Victory', category: 'BATTLES', description: 'Win a duel without losing any health', icon: '🛡️', tier: 'SILVER', criteria_type: 'BATTLE_FLAWLESS', criteria_target: 1, reward_xp: 200, reward_coins: 30 },
  { id: 'bat_10', title: 'Comeback Kid', category: 'BATTLES', description: 'Win a duel starting with under 20% health', icon: '❤️‍🔥', tier: 'GOLD', criteria_type: 'BATTLE_COMEBACK', criteria_target: 1, reward_xp: 350, reward_coins: 60 },
  { id: 'bat_11', title: 'Team Player', category: 'BATTLES', description: 'Participate in a 2v2 or Team Battle', icon: '👥', tier: 'BRONZE', criteria_type: 'TEAM_BATTLE', criteria_target: 1, reward_xp: 75, reward_coins: 10 },
  { id: 'bat_12', title: 'Squad Leader', category: 'BATTLES', description: 'Win 5 Team Battles', icon: '🎖️', tier: 'SILVER', criteria_type: 'TEAM_BATTLE_WIN', criteria_target: 5, reward_xp: 250, reward_coins: 40 },
  { id: 'bat_13', title: 'Subject Gladiator', category: 'BATTLES', description: 'Win battles in Science, Math & English', icon: '🧪', tier: 'GOLD', criteria_type: 'MULTI_SUBJECT_BATTLE', criteria_target: 3, reward_xp: 400, reward_coins: 70 },
  { id: 'bat_14', title: 'Master Negotiator', category: 'BATTLES', description: 'Challenge a friend and win', icon: '🤝', tier: 'PLATINUM', criteria_type: 'FRIEND_DUEL_WIN', criteria_target: 1, reward_xp: 300, reward_coins: 50 },
  { id: 'bat_15', title: 'Overlord of the Arena', category: 'BATTLES', description: 'Reach top 5 in National Battle Leaderboard', icon: '🏆', tier: 'MYTHIC', criteria_type: 'BATTLE_TOP_FIVE', criteria_target: 5, reward_xp: 3000, reward_coins: 600 },

  // 5. AI REVISION & MEMORIZATION (15)
  { id: 'rev_1', title: 'Memory Spark', category: 'REVISION', description: 'Revise 5 AI Flashcards', icon: '🃏', tier: 'BRONZE', criteria_type: 'FLASHCARD_REVISE', criteria_target: 5, reward_xp: 50, reward_coins: 5 },
  { id: 'rev_2', title: 'Memory Architect', category: 'REVISION', description: 'Revise 25 AI Flashcards', icon: '📇', tier: 'SILVER', criteria_type: 'FLASHCARD_REVISE', criteria_target: 25, reward_xp: 150, reward_coins: 20 },
  { id: 'rev_3', title: 'Mnemonic Master', category: 'REVISION', description: 'Generate 3 AI Mnemonics for weak topics', icon: '💡', tier: 'SILVER', criteria_type: 'MNEMONIC_GEN', criteria_target: 3, reward_xp: 150, reward_coins: 20 },
  { id: 'rev_4', title: 'Mind Map Explorer', category: 'REVISION', description: 'Study 5 AI Mind Maps', icon: '🌐', tier: 'GOLD', criteria_type: 'MIND_MAP_STUDY', criteria_target: 5, reward_xp: 300, reward_coins: 50 },
  { id: 'rev_5', title: 'Formula Master', category: 'REVISION', description: 'Review 10 AI Formula Cheat Sheets', icon: '📐', tier: 'GOLD', criteria_type: 'FORMULA_SHEET', criteria_target: 10, reward_xp: 300, reward_coins: 50 },
  { id: 'rev_6', title: 'Storyteller Learner', category: 'REVISION', description: 'Read 5 AI Memory Stories', icon: '📖', tier: 'PLATINUM', criteria_type: 'MEMORY_STORY', criteria_target: 5, reward_xp: 500, reward_coins: 80 },
  { id: 'rev_7', title: 'Spaced Repetition Loyalist', category: 'REVISION', description: 'Complete 7 days of Spaced Repetition reviews', icon: '🔄', tier: 'PLATINUM', criteria_type: 'SPACED_REP_DAYS', criteria_target: 7, reward_xp: 600, reward_coins: 100 },
  { id: 'rev_8', title: 'Weak Concept Eraser', category: 'REVISION', description: 'Turn 5 weak concepts into strong concepts', icon: '💪', tier: 'DIAMOND', criteria_type: 'WEAK_CONCEPT_FIX', criteria_target: 5, reward_xp: 1000, reward_coins: 200 },
  { id: 'rev_9', title: 'Photographic Memory', category: 'REVISION', description: 'Achieve a 90+ Memory Score in Gamification', icon: '📸', tier: 'DIAMOND', criteria_type: 'MEMORY_SCORE_HIGH', criteria_target: 90, reward_xp: 1500, reward_coins: 300 },
  { id: 'rev_10', title: 'AI Memory Deity', category: 'REVISION', description: 'Revise 200 AI Flashcards', icon: '⚡', tier: 'MYTHIC', criteria_type: 'FLASHCARD_REVISE', criteria_target: 200, reward_xp: 3000, reward_coins: 600 },

  { id: 'rev_11', title: 'Quick Memory Check', category: 'REVISION', description: 'Complete 1 daily micro-revision', icon: '⏱️', tier: 'BRONZE', criteria_type: 'MICRO_REVISION', criteria_target: 1, reward_xp: 40, reward_coins: 5 },
  { id: 'rev_12', title: 'Revision Ninja', category: 'REVISION', description: 'Complete 10 micro-revisions', icon: '🥷', tier: 'SILVER', criteria_type: 'MICRO_REVISION', criteria_target: 10, reward_xp: 180, reward_coins: 25 },
  { id: 'rev_13', title: 'Concept Conqueror', category: 'REVISION', description: 'Clear 10 weak concepts detected by AI', icon: '🥊', tier: 'GOLD', criteria_type: 'WEAK_CONCEPT_FIX', criteria_target: 10, reward_xp: 500, reward_coins: 80 },
  { id: 'rev_14', title: 'Mind Vault', category: 'REVISION', description: 'Save 20 Flashcards to your personal vault', icon: '🔐', tier: 'PLATINUM', criteria_type: 'FLASHCARD_SAVE', criteria_target: 20, reward_xp: 400, reward_coins: 60 },
  { id: 'rev_15', title: 'Infinite Retention', category: 'REVISION', description: 'Maintain 95+ Memory Score for 14 consecutive days', icon: '🧠', tier: 'MYTHIC', criteria_type: 'MEMORY_SCORE_STREAK', criteria_target: 14, reward_xp: 2500, reward_coins: 500 },

  // 6. ASSIGNMENTS & HOMEWORK (15)
  { id: 'ass_1', title: 'Homework Submitted', category: 'ASSIGNMENTS', description: 'Submit 1 assignment on time', icon: '📄', tier: 'BRONZE', criteria_type: 'ASSIGNMENT_SUBMIT', criteria_target: 1, reward_xp: 50, reward_coins: 5 },
  { id: 'ass_2', title: 'Reliable Scholar', category: 'ASSIGNMENTS', description: 'Submit 5 assignments on time', icon: '📁', tier: 'SILVER', criteria_type: 'ASSIGNMENT_SUBMIT', criteria_target: 5, reward_xp: 150, reward_coins: 20 },
  { id: 'ass_3', title: 'Assignment Master', category: 'ASSIGNMENTS', description: 'Submit 15 assignments on time', icon: '📑', tier: 'GOLD', criteria_type: 'ASSIGNMENT_SUBMIT', criteria_target: 15, reward_xp: 350, reward_coins: 50 },
  { id: 'ass_4', title: 'Grade A Student', category: 'ASSIGNMENTS', description: 'Score >90% on an assignment', icon: '💯', tier: 'GOLD', criteria_type: 'ASSIGNMENT_GRADE_HIGH', criteria_target: 90, reward_xp: 300, reward_coins: 40 },
  { id: 'ass_5', title: 'Flawless Streak', category: 'ASSIGNMENTS', description: 'Score >90% on 5 consecutive assignments', icon: '🌟', tier: 'PLATINUM', criteria_type: 'ASSIGNMENT_PERFECT_STREAK', criteria_target: 5, reward_xp: 750, reward_coins: 120 },
  { id: 'ass_6', title: 'Academic Perfectionist', category: 'ASSIGNMENTS', description: 'Submit 30 assignments with 100% on-time record', icon: '🥇', tier: 'DIAMOND', criteria_type: 'ASSIGNMENT_PERFECT_RECORD', criteria_target: 30, reward_xp: 1500, reward_coins: 300 },
  { id: 'ass_7', title: 'Scholar Laureate', category: 'ASSIGNMENTS', description: 'Complete 50 assignments with top marks', icon: '👑', tier: 'MYTHIC', criteria_type: 'ASSIGNMENT_TOP_MARKS', criteria_target: 50, reward_xp: 3000, reward_coins: 600 },

  { id: 'ass_8', title: 'Early Bird Submission', category: 'ASSIGNMENTS', description: 'Submit assignment 24 hours before deadline', icon: '⏰', tier: 'BRONZE', criteria_type: 'ASSIGNMENT_EARLY', criteria_target: 1, reward_xp: 60, reward_coins: 10 },
  { id: 'ass_9', title: 'Speedy Solver', category: 'ASSIGNMENTS', description: 'Submit assignment 3 days before deadline', icon: '⚡', tier: 'SILVER', criteria_type: 'ASSIGNMENT_EARLY_3D', criteria_target: 1, reward_xp: 150, reward_coins: 20 },
  { id: 'ass_10', title: 'Peer Reviewer', category: 'ASSIGNMENTS', description: 'Review study materials submitted by teacher', icon: '👁️', tier: 'BRONZE', criteria_type: 'STUDY_MAT_REVIEW', criteria_target: 1, reward_xp: 40, reward_coins: 5 },
  { id: 'ass_11', title: 'Resource Collector', category: 'ASSIGNMENTS', description: 'Download 10 study notes', icon: '📥', tier: 'SILVER', criteria_type: 'STUDY_MAT_DOWNLOAD', criteria_target: 10, reward_xp: 100, reward_coins: 15 },
  { id: 'ass_12', title: 'PYQ Solver', category: 'ASSIGNMENTS', description: 'Solve 5 Previous Year Question sets', icon: '📜', tier: 'GOLD', criteria_type: 'PYQ_SOLVE', criteria_target: 5, reward_xp: 350, reward_coins: 50 },
  { id: 'ass_13', title: 'PYQ Master', category: 'ASSIGNMENTS', description: 'Solve 20 Previous Year Question sets', icon: '🏺', tier: 'PLATINUM', criteria_type: 'PYQ_SOLVE', criteria_target: 20, reward_xp: 900, reward_coins: 150 },
  { id: 'ass_14', title: 'Mock Test Hero', category: 'ASSIGNMENTS', description: 'Complete a full length Mock Test', icon: '🧪', tier: 'GOLD', criteria_type: 'MOCK_TEST', criteria_target: 1, reward_xp: 400, reward_coins: 60 },
  { id: 'ass_15', title: 'Mock Test Legend', category: 'ASSIGNMENTS', description: 'Score Top 1% in a Mock Test', icon: '💎', tier: 'MYTHIC', criteria_type: 'MOCK_TEST_TOP', criteria_target: 1, reward_xp: 2500, reward_coins: 500 },

  // 7. COMPETITIONS & EVENTS (10)
  { id: 'cmp_1', title: 'Championship Participant', category: 'COMPETITIONS', description: 'Join Monthly Championship', icon: '🏟️', tier: 'BRONZE', criteria_type: 'CHAMPIONSHIP_JOIN', criteria_target: 1, reward_xp: 100, reward_coins: 15 },
  { id: 'cmp_2', title: 'Weekly Challenge Winner', category: 'COMPETITIONS', description: 'Complete a Weekly Challenge', icon: '🎖️', tier: 'SILVER', criteria_type: 'WEEKLY_CHALLENGE_WIN', criteria_target: 1, reward_xp: 300, reward_coins: 50 },
  { id: 'cmp_3', title: 'Weekly Challenge Streak', category: 'COMPETITIONS', description: 'Complete 4 consecutive Weekly Challenges', icon: '🏅', tier: 'GOLD', criteria_type: 'WEEKLY_CHALLENGE_STREAK', criteria_target: 4, reward_xp: 800, reward_coins: 150 },
  { id: 'cmp_4', title: 'Top 10 School Rank', category: 'COMPETITIONS', description: 'Reach Top 10 in School Leaderboard', icon: '🏫', tier: 'GOLD', criteria_type: 'SCHOOL_TOP_10', criteria_target: 10, reward_xp: 500, reward_coins: 80 },
  { id: 'cmp_5', title: 'Top 3 Class Rank', category: 'COMPETITIONS', description: 'Reach Top 3 in Class Leaderboard', icon: '🥉', tier: 'PLATINUM', criteria_type: 'CLASS_TOP_3', criteria_target: 3, reward_xp: 800, reward_coins: 150 },
  { id: 'cmp_6', title: 'National Leaderboard Contender', category: 'COMPETITIONS', description: 'Break into Top 100 National Rank', icon: '🇮🇳', tier: 'PLATINUM', criteria_type: 'NATIONAL_TOP_100', criteria_target: 100, reward_xp: 1200, reward_coins: 250 },
  { id: 'cmp_7', title: 'League Promotion', category: 'COMPETITIONS', description: 'Get promoted to a higher League Tier', icon: '📈', tier: 'GOLD', criteria_type: 'LEAGUE_PROMOTION', criteria_target: 1, reward_xp: 400, reward_coins: 60 },
  { id: 'cmp_8', title: 'Diamond League Titan', category: 'COMPETITIONS', description: 'Reach Diamond League tier', icon: '💎', tier: 'DIAMOND', criteria_type: 'REACH_DIAMOND_LEAGUE', criteria_target: 1, reward_xp: 1500, reward_coins: 300 },
  { id: 'cmp_9', title: 'Monthly Podium Finisher', category: 'COMPETITIONS', description: 'Finish Top 3 in Monthly Championship', icon: '🥇', tier: 'DIAMOND', criteria_type: 'MONTHLY_PODIUM', criteria_target: 3, reward_xp: 2500, reward_coins: 500 },
  { id: 'cmp_10', title: 'EDDVA Hall of Fame', category: 'COMPETITIONS', description: 'Inducted into national Hall of Fame for #1 Overall', icon: '🏛️', tier: 'MYTHIC', criteria_type: 'HALL_OF_FAME', criteria_target: 1, reward_xp: 10000, reward_coins: 2000 },
];
