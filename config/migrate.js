// config/migrate.js
// AfroPredict — Full database migration
// Run with: npm run migrate
// Creates all tables with correct schema and indexes for production performance.
// Safe to re-run — uses CREATE TABLE IF NOT EXISTS throughout.

'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'afropredict';

const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  multipleStatements: true,
};

// ============================================================
// TABLE DEFINITIONS
// ============================================================

const MIGRATIONS = [

  // ----------------------------------------------------------
  // 1. Ensure charset on the database (safe on Railway where DB
  //    already exists; skipped silently if no ALTER privilege)
  // ----------------------------------------------------------
  {
    name: 'Set database charset',
    sql: `ALTER DATABASE \`${DB_NAME}\`
          CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
  },

  // ----------------------------------------------------------
  // 3. USERS
  // Stores all registered users across all roles
  // ----------------------------------------------------------
  {
    name: 'Create users table',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name                VARCHAR(100) NOT NULL,
        email               VARCHAR(191) NOT NULL,
        password_hash       VARCHAR(255) NOT NULL,
        role                ENUM('guest','user','vip','admin') NOT NULL DEFAULT 'user',
        country             VARCHAR(100) DEFAULT NULL,
        timezone            VARCHAR(64)  DEFAULT 'UTC',
        telegram_invited    TINYINT(1)   NOT NULL DEFAULT 0,
        stripe_customer_id  VARCHAR(255) DEFAULT NULL,
        is_banned           TINYINT(1)   NOT NULL DEFAULT 0,
        created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email),
        INDEX idx_users_role (role),
        INDEX idx_users_country (country),
        INDEX idx_users_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 4. LEAGUES
  // Populated by API-Football sync; all 1,200+ competitions
  // ----------------------------------------------------------
  {
    name: 'Create leagues table',
    sql: `
      CREATE TABLE IF NOT EXISTS leagues (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        api_league_id   INT UNSIGNED NOT NULL,
        name            VARCHAR(150) NOT NULL,
        country         VARCHAR(100) NOT NULL,
        continent       ENUM('Europe','Africa','Asia','Americas','Oceania','World') NOT NULL DEFAULT 'World',
        flag_url        VARCHAR(500) DEFAULT NULL,
        logo_url        VARCHAR(500) DEFAULT NULL,
        is_popular      TINYINT(1)   NOT NULL DEFAULT 0,
        is_active       TINYINT(1)   NOT NULL DEFAULT 1,
        season          INT          DEFAULT NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_leagues_api_id (api_league_id),
        INDEX idx_leagues_continent (continent),
        INDEX idx_leagues_country (country),
        INDEX idx_leagues_is_popular (is_popular),
        INDEX idx_leagues_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 5. TEAMS
  // Club/national team data from API-Football
  // ----------------------------------------------------------
  {
    name: 'Create teams table',
    sql: `
      CREATE TABLE IF NOT EXISTS teams (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        api_team_id   INT UNSIGNED NOT NULL,
        name          VARCHAR(150) NOT NULL,
        logo_url      VARCHAR(500) DEFAULT NULL,
        league_id     INT UNSIGNED DEFAULT NULL,
        country       VARCHAR(100) DEFAULT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_teams_api_id (api_team_id),
        INDEX idx_teams_league_id (league_id),
        INDEX idx_teams_name (name),
        CONSTRAINT fk_teams_league FOREIGN KEY (league_id)
          REFERENCES leagues (id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 6. PREDICTIONS
  // Core table — one row per published prediction/tip
  // ----------------------------------------------------------
  {
    name: 'Create predictions table',
    sql: `
      CREATE TABLE IF NOT EXISTS predictions (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        fixture_id          INT UNSIGNED DEFAULT NULL COMMENT 'API-Football fixture ID',
        league_id           INT UNSIGNED NOT NULL,
        home_team           VARCHAR(150) NOT NULL,
        away_team           VARCHAR(150) NOT NULL,
        home_team_logo      VARCHAR(500) DEFAULT NULL,
        away_team_logo      VARCHAR(500) DEFAULT NULL,
        match_date          DATETIME     NOT NULL,
        tip                 VARCHAR(50)  NOT NULL COMMENT 'e.g. Home Win, Over 2.5, BTTS',
        market              VARCHAR(50)  NOT NULL COMMENT 'e.g. 1X2, Over/Under, BTTS, Correct Score',
        odds                DECIMAL(6,2) DEFAULT NULL,
        confidence_score    TINYINT UNSIGNED DEFAULT NULL COMMENT '0-100 algorithm score',
        visibility          ENUM('free','vip') NOT NULL DEFAULT 'free',
        result              ENUM('pending','won','lost','void') NOT NULL DEFAULT 'pending',
        analysis            TEXT         DEFAULT NULL COMMENT 'Short expert analysis shown on detail page',
        home_form           VARCHAR(20)  DEFAULT NULL COMMENT 'Last 5 results e.g. WWDLW',
        away_form           VARCHAR(20)  DEFAULT NULL COMMENT 'Last 5 results e.g. LWWWD',
        h2h_summary         VARCHAR(255) DEFAULT NULL COMMENT 'e.g. Arsenal won 3 of last 5 meetings',
        slug                VARCHAR(300) DEFAULT NULL COMMENT 'SEO-friendly URL slug',
        published_at        DATETIME     DEFAULT NULL,
        created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_predictions_slug (slug),
        INDEX idx_predictions_league_id (league_id),
        INDEX idx_predictions_match_date (match_date),
        INDEX idx_predictions_visibility (visibility),
        INDEX idx_predictions_result (result),
        INDEX idx_predictions_market (market),
        INDEX idx_predictions_published_at (published_at),
        INDEX idx_predictions_confidence (confidence_score),
        CONSTRAINT fk_predictions_league FOREIGN KEY (league_id)
          REFERENCES leagues (id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 7. BOOKMARKS
  // Users can save predictions to their personal list
  // ----------------------------------------------------------
  {
    name: 'Create bookmarks table',
    sql: `
      CREATE TABLE IF NOT EXISTS bookmarks (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id         INT UNSIGNED NOT NULL,
        prediction_id   INT UNSIGNED NOT NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_bookmarks_user_prediction (user_id, prediction_id),
        INDEX idx_bookmarks_user_id (user_id),
        INDEX idx_bookmarks_prediction_id (prediction_id),
        CONSTRAINT fk_bookmarks_user FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_bookmarks_prediction FOREIGN KEY (prediction_id)
          REFERENCES predictions (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 8. BET HISTORY
  // User-submitted manual bet tracking log
  // ----------------------------------------------------------
  {
    name: 'Create bet_history table',
    sql: `
      CREATE TABLE IF NOT EXISTS bet_history (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id         INT UNSIGNED NOT NULL,
        prediction_id   INT UNSIGNED DEFAULT NULL COMMENT 'Optional link to a G33 prediction',
        stake           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        odds            DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
        result          ENUM('won','lost','pending','void') NOT NULL DEFAULT 'pending',
        profit_loss     DECIMAL(10,2) DEFAULT NULL COMMENT 'Positive = profit, negative = loss',
        currency        VARCHAR(10)   NOT NULL DEFAULT 'USD',
        notes           VARCHAR(500)  DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        INDEX idx_bet_history_user_id (user_id),
        INDEX idx_bet_history_prediction_id (prediction_id),
        INDEX idx_bet_history_result (result),
        INDEX idx_bet_history_created_at (created_at),
        CONSTRAINT fk_bet_history_user FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_bet_history_prediction FOREIGN KEY (prediction_id)
          REFERENCES predictions (id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 9. COMMENTS
  // Users can comment on prediction detail pages
  // ----------------------------------------------------------
  {
    name: 'Create comments table',
    sql: `
      CREATE TABLE IF NOT EXISTS comments (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id         INT UNSIGNED NOT NULL,
        prediction_id   INT UNSIGNED NOT NULL,
        content         TEXT         NOT NULL,
        is_approved     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'Admin can hide comments',
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        INDEX idx_comments_user_id (user_id),
        INDEX idx_comments_prediction_id (prediction_id),
        INDEX idx_comments_created_at (created_at),
        CONSTRAINT fk_comments_user FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_comments_prediction FOREIGN KEY (prediction_id)
          REFERENCES predictions (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 10. SUBSCRIPTIONS
  // Tracks Stripe and Paystack subscription lifecycle
  // ----------------------------------------------------------
  {
    name: 'Create subscriptions table',
    sql: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id                 INT UNSIGNED NOT NULL,
        stripe_subscription_id  VARCHAR(255) DEFAULT NULL,
        stripe_customer_id      VARCHAR(255) DEFAULT NULL,
        paystack_reference      VARCHAR(255) DEFAULT NULL,
        plan                    ENUM('monthly','quarterly','annual') NOT NULL,
        amount                  DECIMAL(8,2) NOT NULL,
        currency                VARCHAR(10)  NOT NULL DEFAULT 'USD',
        status                  ENUM('active','trialing','expired','cancelled','past_due') NOT NULL DEFAULT 'trialing',
        starts_at               DATETIME     DEFAULT NULL,
        expires_at              DATETIME     DEFAULT NULL,
        trial_ends_at           DATETIME     DEFAULT NULL,
        cancelled_at            DATETIME     DEFAULT NULL,
        created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        INDEX idx_subscriptions_user_id (user_id),
        INDEX idx_subscriptions_status (status),
        INDEX idx_subscriptions_stripe_id (stripe_subscription_id),
        INDEX idx_subscriptions_expires_at (expires_at),
        CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 11. BLOG POSTS
  // Admin-authored SEO articles — fully indexable
  // ----------------------------------------------------------
  {
    name: 'Create blog_posts table',
    sql: `
      CREATE TABLE IF NOT EXISTS blog_posts (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title               VARCHAR(300) NOT NULL,
        slug                VARCHAR(300) NOT NULL,
        excerpt             VARCHAR(500) DEFAULT NULL COMMENT 'Short summary shown on blog index',
        content             LONGTEXT     NOT NULL,
        featured_image      VARCHAR(500) DEFAULT NULL,
        meta_title          VARCHAR(300) DEFAULT NULL,
        meta_description    VARCHAR(500) DEFAULT NULL,
        keywords            VARCHAR(500) DEFAULT NULL COMMENT 'Comma-separated target keywords',
        author_id           INT UNSIGNED NOT NULL,
        category            VARCHAR(100) DEFAULT NULL COMMENT 'e.g. Match Preview, Betting Guide',
        is_published        TINYINT(1)   NOT NULL DEFAULT 0,
        published_at        DATETIME     DEFAULT NULL,
        created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_blog_slug (slug),
        INDEX idx_blog_author_id (author_id),
        INDEX idx_blog_is_published (is_published),
        INDEX idx_blog_published_at (published_at),
        INDEX idx_blog_category (category),
        CONSTRAINT fk_blog_author FOREIGN KEY (author_id)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 12. SEO SETTINGS
  // Per-page SEO meta overrides editable from admin panel
  // ----------------------------------------------------------
  {
    name: 'Create seo_settings table',
    sql: `
      CREATE TABLE IF NOT EXISTS seo_settings (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        page                VARCHAR(100) NOT NULL COMMENT 'e.g. home, predictions, pricing, about',
        meta_title          VARCHAR(300) DEFAULT NULL,
        meta_description    VARCHAR(500) DEFAULT NULL,
        og_image            VARCHAR(500) DEFAULT NULL,
        keywords            VARCHAR(500) DEFAULT NULL,
        updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_seo_page (page)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 13. SEED: Default SEO settings for all public pages
  // ----------------------------------------------------------
  {
    name: 'Seed default SEO settings',
    fn: async (conn) => {
      const rows = [
        ['home',        'AfroPredict - Free Football Predictions & Betting Tips Today',
                        'Get accurate free football predictions, VIP tips, and daily betting analysis covering 1,200+ leagues worldwide. Precision tips for Premier League, Champions League, and more.',
                        'football predictions today, free football tips, best prediction site, sure tips today, football betting tips'],
        ['predictions', 'Todays Football Predictions - All Leagues | AfroPredict',
                        'Browse todays free and VIP football predictions across all 1,200+ leagues. Filter by market, league, or continent. Over 2.5, BTTS, 1X2 tips updated daily.',
                        'football predictions today, free tips, over 2.5 goals, BTTS tips, accumulator tips'],
        ['pricing',     'VIP Football Tips - Subscribe from $4.89/month | AfroPredict',
                        'Unlock premium VIP football tips with high-confidence picks, early access, and Telegram alerts. Plans from $4.89/month. 3-day free trial available.',
                        'VIP football tips, premium predictions, best tipster subscription, football tips site'],
        ['leaderboard', 'Prediction Accuracy Leaderboard - Track Record | AfroPredict',
                        'See AfroPredict verified prediction accuracy stats and tipster performance leaderboard. Transparent results across all markets and leagues.',
                        'football prediction accuracy, tipster results, best prediction site record'],
        ['blog',        'Football Betting Guides & Match Previews | AfroPredict Blog',
                        'Expert football betting guides, match previews, and league analysis. Learn how to win football bets with data-driven insights from AfroPredict.',
                        'football betting guide, match preview, how to win football bets, league analysis'],
        ['about',       'About AfroPredict - Global Football Prediction Platform',
                        'AfroPredict is a global football prediction platform serving free and VIP tips powered by algorithm-generated predictions and API-Football data covering 1,200+ leagues.',
                        'about AfroPredict, football prediction platform, best tipster'],
        ['contact',     'Contact AfroPredict - Get in Touch',
                        'Contact the AfroPredict team for support, partnership enquiries, or feedback. We are here to help bettors worldwide win more.',
                        'contact AfroPredict, football tips support'],
        ['privacy',     'Privacy Policy | AfroPredict',
                        'Read the AfroPredict privacy policy. We are committed to protecting your personal data in compliance with GDPR and global data protection standards.',
                        'AfroPredict privacy policy, data protection'],
        ['terms',       'Terms of Service | AfroPredict',
                        'Read the AfroPredict terms of service. By using our platform you agree to these terms governing free and VIP prediction services.',
                        'AfroPredict terms of service, betting tips terms'],
        ['login',       'Login to AfroPredict - Access Your Dashboard',
                        'Log in to your AfroPredict account to access bookmarks, bet history, and VIP tips.',
                        'AfroPredict login'],
        ['register',    'Create a Free Account | AfroPredict',
                        'Register for a free AfroPredict account to save predictions, track your bets, and upgrade to VIP for premium tips.',
                        'AfroPredict register, free football tips account'],
      ];
      for (const [page, title, desc, kw] of rows) {
        await conn.execute(
          'INSERT IGNORE INTO seo_settings (page, meta_title, meta_description, keywords) VALUES (?, ?, ?, ?)',
          [page, title, desc, kw]
        );
      }
    },
  },

  // ----------------------------------------------------------
  // 14. SEED: Popular leagues (added once API sync runs they
  //     are updated — these serve as initial placeholders)
  // ----------------------------------------------------------
  {
    name: 'Seed popular leagues',
    sql: `
      INSERT IGNORE INTO leagues (api_league_id, name, country, continent, is_popular, is_active) VALUES
      (39,  'Premier League',       'England',       'Europe',   1, 1),
      (140, 'La Liga',              'Spain',         'Europe',   1, 1),
      (135, 'Serie A',              'Italy',         'Europe',   1, 1),
      (78,  'Bundesliga',           'Germany',       'Europe',   1, 1),
      (61,  'Ligue 1',              'France',        'Europe',   1, 1),
      (2,   'UEFA Champions League','World',         'World',    1, 1),
      (3,   'UEFA Europa League',   'World',         'World',    1, 1),
      (1,   'FIFA World Cup',       'World',         'World',    1, 1),
      (6,   'Africa Cup of Nations','World',         'Africa',   1, 1),
      (253, 'Major League Soccer',  'USA',           'Americas', 1, 1),
      (71,  'Brazilian Serie A',    'Brazil',        'Americas', 1, 1),
      (323, 'Indian Super League',  'India',         'Asia',     1, 1);
    `,
  },

  // ----------------------------------------------------------
  // 15. SEED: Default admin user
  //     Password: Admin@Afro! (bcrypt hash — CHANGE IMMEDIATELY)
  // ----------------------------------------------------------
  {
    name: 'Seed default admin user',
    sql: `
      INSERT IGNORE INTO users (name, email, password_hash, role, country, timezone)
      VALUES (
        'AfroPredict Admin',
        'admin@afropredict.com',
        '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCKQlMOLJhBsKDWmPRUpNQ2',
        'admin',
        'United Kingdom',
        'Europe/London'
      );
    `,
  },
];

// ============================================================
// MIGRATION RUNNER
// ============================================================

async function runMigrations() {
  let connection;

  try {
    console.log('\n[MIGRATE] Connecting to MySQL...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('[MIGRATE] Connected.\n');

    for (const migration of MIGRATIONS) {
      try {
        console.log(`[MIGRATE] Running: ${migration.name}`);
        if (migration.fn) {
          await migration.fn(connection);
        } else {
          await connection.query(migration.sql);
        }
        console.log(`[MIGRATE] ✓ Done: ${migration.name}`);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          console.log(`[MIGRATE] ↷ Skipped (already exists): ${migration.name}`);
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR' || migration.name === 'Set database charset') {
          console.log(`[MIGRATE] ↷ Skipped (no privilege): ${migration.name}`);
        } else {
          throw err;
        }
      }
    }

    console.log('\n[MIGRATE] ✅ All migrations completed successfully.');
    console.log('[MIGRATE] Database is ready for AfroPredict.\n');
    console.log('---------------------------------------------------');
    console.log('Default admin credentials:');
    console.log('  Email:    admin@afropredict.com');
    console.log('  Password: Admin@Afro!');
    console.log('  ⚠️  CHANGE THE ADMIN PASSWORD IMMEDIATELY after first login!');
    console.log('---------------------------------------------------\n');

  } catch (error) {
    console.error('\n[MIGRATE] ❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('[MIGRATE] Connection closed.');
    }
  }
}

runMigrations();
