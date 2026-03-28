import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enable UUID extension ─────────────────────────────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── ENUMS ─────────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE TYPE tenant_type_enum AS ENUM ('platform','institute','solo')`);
    await queryRunner.query(`CREATE TYPE tenant_status_enum AS ENUM ('active','suspended','trial')`);
    await queryRunner.query(`CREATE TYPE tenant_plan_enum AS ENUM ('starter','growth','scale','enterprise','platform')`);
    await queryRunner.query(`CREATE TYPE user_role_enum AS ENUM ('super_admin','institute_admin','teacher','student','parent')`);
    await queryRunner.query(`CREATE TYPE user_status_enum AS ENUM ('active','inactive','suspended','pending_verification')`);
    await queryRunner.query(`CREATE TYPE exam_target_enum AS ENUM ('jee','neet','both')`);
    await queryRunner.query(`CREATE TYPE student_class_enum AS ENUM ('8','9','10','11','12','dropper')`);
    await queryRunner.query(`CREATE TYPE exam_year_enum AS ENUM ('2025','2026','2027','2028')`);
    await queryRunner.query(`CREATE TYPE subscription_plan_enum AS ENUM ('free','pro','crash_course','institute')`);
    await queryRunner.query(`CREATE TYPE question_type_enum AS ENUM ('mcq_single','mcq_multi','integer','descriptive')`);
    await queryRunner.query(`CREATE TYPE difficulty_enum AS ENUM ('easy','medium','hard')`);
    await queryRunner.query(`CREATE TYPE question_source_enum AS ENUM ('teacher','global','pyq','ai_generated')`);
    await queryRunner.query(`CREATE TYPE batch_status_enum AS ENUM ('active','inactive','completed')`);
    await queryRunner.query(`CREATE TYPE test_session_status_enum AS ENUM ('in_progress','submitted','auto_submitted','abandoned')`);
    await queryRunner.query(`CREATE TYPE error_type_enum AS ENUM ('conceptual','silly','time','guess','skip')`);
    await queryRunner.query(`CREATE TYPE topic_status_enum AS ENUM ('locked','unlocked','in_progress','completed')`);
    await queryRunner.query(`CREATE TYPE battle_mode_enum AS ENUM ('quick_duel','topic_battle','battle_royale','weekly_tournament','clan_war','bot_practice','daily')`);
    await queryRunner.query(`CREATE TYPE battle_status_enum AS ENUM ('waiting','active','finished','abandoned')`);
    await queryRunner.query(`CREATE TYPE elo_tier_enum AS ENUM ('iron','bronze','silver','gold','platinum','diamond','champion')`);
    await queryRunner.query(`CREATE TYPE doubt_source_enum AS ENUM ('lecture','question','battle','manual')`);
    await queryRunner.query(`CREATE TYPE doubt_status_enum AS ENUM ('open','ai_resolved','escalated','teacher_resolved')`);
    await queryRunner.query(`CREATE TYPE explanation_mode_enum AS ENUM ('short','detailed')`);
    await queryRunner.query(`CREATE TYPE lecture_type_enum AS ENUM ('recorded','live')`);
    await queryRunner.query(`CREATE TYPE lecture_status_enum AS ENUM ('processing','published','scheduled','live','ended','draft')`);
    await queryRunner.query(`CREATE TYPE plan_item_type_enum AS ENUM ('lecture','practice','revision','mock_test','doubt_session','battle')`);
    await queryRunner.query(`CREATE TYPE plan_item_status_enum AS ENUM ('pending','completed','skipped','rescheduled')`);
    await queryRunner.query(`CREATE TYPE weak_topic_severity_enum AS ENUM ('low','medium','high','critical')`);
    await queryRunner.query(`CREATE TYPE engagement_state_enum AS ENUM ('engaged','bored','confused','frustrated','thriving')`);
    await queryRunner.query(`CREATE TYPE engagement_context_enum AS ENUM ('lecture','practice','battle','mock_test')`);
    await queryRunner.query(`CREATE TYPE leaderboard_scope_enum AS ENUM ('global','state','city','school','friend','subject','battle_xp')`);
    await queryRunner.query(`CREATE TYPE leaderboard_period_enum AS ENUM ('all_time','monthly','weekly')`);
    await queryRunner.query(`CREATE TYPE notification_type_enum AS ENUM ('morning_reminder','live_class_starting','topic_quiz_available','battle_live','rank_changed','streak_danger','weak_topic_alert','mock_result_ready','battle_challenge','achievement_unlocked','weekly_report','score_drop_alert','parent_attendance_alert','teacher_flagged','new_doubt','subscription_renewal','general')`);
    await queryRunner.query(`CREATE TYPE notification_channel_enum AS ENUM ('push','whatsapp','sms','email','in_app')`);
    await queryRunner.query(`CREATE TYPE notification_status_enum AS ENUM ('pending','sent','failed','read')`);
    await queryRunner.query(`CREATE TYPE enrollment_status_enum AS ENUM ('active','suspended','completed')`);
    await queryRunner.query(`CREATE TYPE language_enum AS ENUM ('en','hi')`);

    // ── TENANTS ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR NOT NULL UNIQUE,
        subdomain VARCHAR UNIQUE,
        type tenant_type_enum NOT NULL DEFAULT 'institute',
        status tenant_status_enum NOT NULL DEFAULT 'trial',
        plan tenant_plan_enum NOT NULL DEFAULT 'starter',
        logo_url VARCHAR,
        brand_color VARCHAR DEFAULT '#F97316',
        welcome_message VARCHAR,
        max_students INT NOT NULL DEFAULT 100,
        max_teachers INT NOT NULL DEFAULT 3,
        billing_email VARCHAR,
        stripe_customer_id VARCHAR,
        stripe_subscription_id VARCHAR,
        trial_ends_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    // Insert platform tenant (B2C root)
    await queryRunner.query(`
      INSERT INTO tenants (name, subdomain, type, status, plan, max_students, max_teachers)
      VALUES ('APEXIQ Platform', 'platform', 'platform', 'active', 'platform', 1000000, 1000000)
    `);

    // ── USERS ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        phone_number VARCHAR NOT NULL UNIQUE,
        email VARCHAR,
        full_name VARCHAR NOT NULL,
        profile_picture_url VARCHAR,
        password VARCHAR,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        is_first_login BOOLEAN NOT NULL DEFAULT TRUE,
        last_login_at TIMESTAMPTZ,
        role user_role_enum NOT NULL DEFAULT 'student',
        status user_status_enum NOT NULL DEFAULT 'pending_verification',
        refresh_token VARCHAR,
        notification_prefs JSONB NOT NULL DEFAULT '{"push":true,"whatsapp":true,"email":false,"sms":false}',
        fcm_token VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_users_tenant ON users(tenant_id)`);
    await queryRunner.query(`CREATE INDEX idx_users_role ON users(role, tenant_id)`);

    // ── STUDENTS ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        exam_target exam_target_enum NOT NULL DEFAULT 'jee',
        class student_class_enum NOT NULL,
        exam_year exam_year_enum NOT NULL,
        target_college VARCHAR,
        daily_study_hours FLOAT NOT NULL DEFAULT 4,
        language language_enum NOT NULL DEFAULT 'en',
        city VARCHAR,
        state VARCHAR,
        coaching_name VARCHAR,
        xp_total INT NOT NULL DEFAULT 0,
        current_streak INT NOT NULL DEFAULT 0,
        longest_streak INT NOT NULL DEFAULT 0,
        last_active_date DATE,
        subscription_plan subscription_plan_enum NOT NULL DEFAULT 'free',
        subscription_expires_at TIMESTAMPTZ,
        onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
        diagnostic_completed BOOLEAN NOT NULL DEFAULT FALSE,
        baseline_rank_estimate INT,
        parent_user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_students_tenant ON students(tenant_id)`);
    await queryRunner.query(`CREATE INDEX idx_students_city ON students(city)`);
    await queryRunner.query(`CREATE INDEX idx_students_state ON students(state)`);

    // ── SUBJECTS → CHAPTERS → TOPICS ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE subjects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        name VARCHAR NOT NULL,
        exam_target exam_target_enum NOT NULL,
        icon VARCHAR,
        color_code VARCHAR,
        sort_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE chapters (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        subject_id UUID NOT NULL REFERENCES subjects(id),
        name VARCHAR NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        jee_weightage FLOAT NOT NULL DEFAULT 0,
        neet_weightage FLOAT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE topics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        chapter_id UUID NOT NULL REFERENCES chapters(id),
        name VARCHAR NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        gate_pass_percentage FLOAT NOT NULL DEFAULT 70,
        estimated_study_minutes INT NOT NULL DEFAULT 60,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        prerequisite_topic_ids JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    // ── QUESTIONS ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE questions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        topic_id UUID NOT NULL REFERENCES topics(id),
        content TEXT NOT NULL,
        content_image_url VARCHAR,
        solution_text TEXT,
        solution_video_url VARCHAR,
        type question_type_enum NOT NULL DEFAULT 'mcq_single',
        difficulty difficulty_enum NOT NULL DEFAULT 'medium',
        source question_source_enum NOT NULL DEFAULT 'teacher',
        marks_correct FLOAT NOT NULL DEFAULT 4,
        marks_wrong FLOAT NOT NULL DEFAULT -1,
        integer_answer VARCHAR,
        irt_b_param FLOAT,
        irt_a_param FLOAT,
        avg_time_seconds FLOAT,
        avg_accuracy FLOAT,
        attempt_count INT NOT NULL DEFAULT 0,
        pyq_year INT,
        pyq_paper VARCHAR,
        tags JSONB NOT NULL DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_questions_topic ON questions(topic_id, tenant_id)`);
    await queryRunner.query(`CREATE INDEX idx_questions_difficulty ON questions(difficulty, topic_id)`);

    await queryRunner.query(`
      CREATE TABLE question_options (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        option_label VARCHAR NOT NULL,
        content TEXT NOT NULL,
        content_image_url VARCHAR,
        is_correct BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    // ── BATCHES & ENROLLMENTS ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE batches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        name VARCHAR NOT NULL,
        exam_target exam_target_enum NOT NULL,
        class student_class_enum NOT NULL,
        teacher_id UUID REFERENCES users(id),
        max_students INT NOT NULL DEFAULT 60,
        fee_amount DECIMAL(10,2),
        status batch_status_enum NOT NULL DEFAULT 'active',
        start_date DATE,
        end_date DATE,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE enrollments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        student_id UUID NOT NULL REFERENCES students(id),
        batch_id UUID NOT NULL REFERENCES batches(id),
        status enrollment_status_enum NOT NULL DEFAULT 'active',
        enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fee_paid DECIMAL(10,2),
        fee_paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        UNIQUE(student_id, batch_id)
      )
    `);

    // ── ASSESSMENT ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE mock_tests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        title VARCHAR NOT NULL,
        type VARCHAR NOT NULL,
        total_marks INT NOT NULL DEFAULT 300,
        duration_minutes INT NOT NULL DEFAULT 180,
        question_ids JSONB NOT NULL DEFAULT '[]',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        scheduled_at TIMESTAMPTZ,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE test_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        student_id UUID NOT NULL REFERENCES students(id),
        mock_test_id UUID NOT NULL REFERENCES mock_tests(id),
        status test_session_status_enum NOT NULL DEFAULT 'in_progress',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_at TIMESTAMPTZ,
        total_score FLOAT,
        percentile FLOAT,
        predicted_rank INT,
        correct_count INT,
        wrong_count INT,
        skipped_count INT,
        error_breakdown JSONB DEFAULT '{"conceptual":0,"silly":0,"time":0,"guess":0,"skip":0}',
        chapter_heatmap JSONB,
        ai_feedback TEXT,
        time_distribution JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_test_sessions_student ON test_sessions(student_id, tenant_id)`);

    await queryRunner.query(`
      CREATE TABLE question_attempts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        test_session_id UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id),
        question_id UUID NOT NULL REFERENCES questions(id),
        selected_option_ids JSONB NOT NULL DEFAULT '[]',
        integer_answer VARCHAR,
        is_correct BOOLEAN,
        marks_awarded FLOAT NOT NULL DEFAULT 0,
        time_spent_seconds INT NOT NULL DEFAULT 0,
        is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
        error_type error_type_enum,
        answered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_question_attempts_session ON question_attempts(test_session_id, student_id)`);

    await queryRunner.query(`
      CREATE TABLE topic_progress (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        student_id UUID NOT NULL REFERENCES students(id),
        topic_id UUID NOT NULL REFERENCES topics(id),
        status topic_status_enum NOT NULL DEFAULT 'locked',
        best_accuracy FLOAT NOT NULL DEFAULT 0,
        attempt_count INT NOT NULL DEFAULT 0,
        unlocked_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        UNIQUE(student_id, topic_id)
      )
    `);

    // ── BATTLES ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE battles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        topic_id UUID REFERENCES topics(id),
        room_code VARCHAR NOT NULL UNIQUE,
        mode battle_mode_enum NOT NULL DEFAULT 'quick_duel',
        status battle_status_enum NOT NULL DEFAULT 'waiting',
        max_participants INT NOT NULL DEFAULT 2,
        total_rounds INT NOT NULL DEFAULT 10,
        seconds_per_round INT NOT NULL DEFAULT 30,
        question_ids JSONB NOT NULL DEFAULT '[]',
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        scheduled_at TIMESTAMPTZ,
        winner_id UUID,
        replay_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_battles_status ON battles(status, scheduled_at)`);
    await queryRunner.query(`CREATE INDEX idx_battles_tenant ON battles(tenant_id, mode)`);

    await queryRunner.query(`
      CREATE TABLE battle_participants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        battle_id UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id),
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        rounds_won INT NOT NULL DEFAULT 0,
        total_score FLOAT NOT NULL DEFAULT 0,
        elo_before INT NOT NULL DEFAULT 1000,
        elo_after INT,
        elo_change INT,
        xp_earned INT NOT NULL DEFAULT 0,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE battle_answers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        battle_id UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES battle_participants(id) ON DELETE CASCADE,
        question_id UUID NOT NULL REFERENCES questions(id),
        round_number INT NOT NULL,
        selected_option_id UUID,
        is_correct BOOLEAN,
        response_time_ms INT,
        won_round BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE student_elo (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL UNIQUE REFERENCES students(id),
        elo_rating INT NOT NULL DEFAULT 1000,
        tier elo_tier_enum NOT NULL DEFAULT 'iron',
        battle_xp INT NOT NULL DEFAULT 0,
        battles_played INT NOT NULL DEFAULT 0,
        battles_won INT NOT NULL DEFAULT 0,
        win_streak INT NOT NULL DEFAULT 0,
        highest_win_streak INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    // ── LEARNING ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE doubts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        student_id UUID NOT NULL REFERENCES students(id),
        topic_id UUID REFERENCES topics(id),
        question_text TEXT,
        question_image_url VARCHAR,
        ocr_extracted_text TEXT,
        source doubt_source_enum NOT NULL DEFAULT 'manual',
        source_ref_id UUID,
        explanation_mode explanation_mode_enum NOT NULL DEFAULT 'short',
        status doubt_status_enum NOT NULL DEFAULT 'open',
        ai_explanation TEXT,
        ai_concept_links JSONB NOT NULL DEFAULT '[]',
        ai_similar_question_ids JSONB NOT NULL DEFAULT '[]',
        teacher_id UUID,
        teacher_response TEXT,
        is_helpful BOOLEAN,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_doubts_student ON doubts(student_id, status)`);

    await queryRunner.query(`
      CREATE TABLE lectures (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        batch_id UUID NOT NULL REFERENCES batches(id),
        teacher_id UUID NOT NULL REFERENCES users(id),
        topic_id UUID REFERENCES topics(id),
        title VARCHAR NOT NULL,
        description TEXT,
        type lecture_type_enum NOT NULL,
        status lecture_status_enum NOT NULL DEFAULT 'processing',
        video_url VARCHAR,
        video_duration_seconds INT,
        thumbnail_url VARCHAR,
        ai_notes_markdown TEXT,
        ai_key_concepts JSONB NOT NULL DEFAULT '[]',
        ai_formulas JSONB NOT NULL DEFAULT '[]',
        transcript TEXT,
        quiz_checkpoints JSONB NOT NULL DEFAULT '[]',
        scheduled_at TIMESTAMPTZ,
        live_meeting_url VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE lecture_progress (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        student_id UUID NOT NULL REFERENCES students(id),
        lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
        watch_percentage FLOAT NOT NULL DEFAULT 0,
        last_position_seconds INT NOT NULL DEFAULT 0,
        rewind_count INT NOT NULL DEFAULT 0,
        is_completed BOOLEAN NOT NULL DEFAULT FALSE,
        confusion_flags JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        UNIQUE(student_id, lecture_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE study_plans (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        student_id UUID NOT NULL UNIQUE REFERENCES students(id),
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_until TIMESTAMPTZ,
        ai_version VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE plan_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        study_plan_id UUID NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
        scheduled_date DATE NOT NULL,
        type plan_item_type_enum NOT NULL,
        ref_id UUID,
        title VARCHAR NOT NULL,
        estimated_minutes INT NOT NULL DEFAULT 30,
        sort_order INT NOT NULL DEFAULT 0,
        status plan_item_status_enum NOT NULL DEFAULT 'pending',
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_plan_items_date ON plan_items(study_plan_id, scheduled_date)`);

    // ── ANALYTICS ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE performance_profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL UNIQUE REFERENCES students(id),
        predicted_rank INT,
        rank_confidence FLOAT,
        overall_accuracy FLOAT NOT NULL DEFAULT 0,
        avg_speed_seconds FLOAT,
        chapter_accuracy JSONB NOT NULL DEFAULT '{}',
        subject_accuracy JSONB NOT NULL DEFAULT '{}',
        last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE weak_topics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES students(id),
        topic_id UUID NOT NULL REFERENCES topics(id),
        severity weak_topic_severity_enum NOT NULL DEFAULT 'medium',
        accuracy FLOAT NOT NULL DEFAULT 0,
        wrong_count INT NOT NULL DEFAULT 0,
        doubt_count INT NOT NULL DEFAULT 0,
        rewind_count INT NOT NULL DEFAULT 0,
        last_attempted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        UNIQUE(student_id, topic_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE engagement_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES students(id),
        state engagement_state_enum NOT NULL,
        context engagement_context_enum NOT NULL,
        context_ref_id UUID,
        confidence FLOAT,
        signals JSONB,
        action_taken VARCHAR,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_engagement_student_time ON engagement_logs(student_id, logged_at DESC)`);

    await queryRunner.query(`
      CREATE TABLE leaderboard_entries (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id UUID NOT NULL REFERENCES students(id),
        scope leaderboard_scope_enum NOT NULL,
        scope_value VARCHAR,
        period leaderboard_period_enum NOT NULL DEFAULT 'all_time',
        score FLOAT NOT NULL DEFAULT 0,
        rank INT NOT NULL DEFAULT 0,
        percentile FLOAT,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_leaderboard_scope ON leaderboard_entries(scope, scope_value, score DESC)`);

    await queryRunner.query(`
      CREATE TABLE notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id),
        tenant_id UUID NOT NULL,
        type notification_type_enum NOT NULL,
        channel notification_channel_enum NOT NULL,
        status notification_status_enum NOT NULL DEFAULT 'pending',
        title VARCHAR NOT NULL,
        body TEXT NOT NULL,
        data JSONB,
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        failure_reason VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_notifications_user ON notifications(user_id, status, created_at DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'notifications', 'leaderboard_entries', 'engagement_logs', 'weak_topics',
      'performance_profiles', 'plan_items', 'study_plans', 'lecture_progress',
      'lectures', 'doubts', 'student_elo', 'battle_answers', 'battle_participants',
      'battles', 'topic_progress', 'question_attempts', 'test_sessions',
      'mock_tests', 'enrollments', 'batches', 'question_options', 'questions',
      'topics', 'chapters', 'subjects', 'students', 'users', 'tenants',
    ];
    for (const t of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    const enums = [
      'tenant_type_enum','tenant_status_enum','tenant_plan_enum','user_role_enum',
      'user_status_enum','exam_target_enum','student_class_enum','exam_year_enum',
      'subscription_plan_enum','question_type_enum','difficulty_enum','question_source_enum',
      'batch_status_enum','test_session_status_enum','error_type_enum','topic_status_enum',
      'battle_mode_enum','battle_status_enum','elo_tier_enum','doubt_source_enum',
      'doubt_status_enum','explanation_mode_enum','lecture_type_enum','lecture_status_enum',
      'plan_item_type_enum','plan_item_status_enum','weak_topic_severity_enum',
      'engagement_state_enum','engagement_context_enum','leaderboard_scope_enum',
      'leaderboard_period_enum','notification_type_enum','notification_channel_enum',
      'notification_status_enum','enrollment_status_enum','language_enum',
    ];
    for (const e of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS ${e}`);
    }
  }
}
