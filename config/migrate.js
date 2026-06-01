// config/migrate.js
// Rooted Predictions — Full database migration
// Run with: npm run migrate
// Creates all tables with correct schema and indexes for production performance.
// Safe to re-run — uses CREATE TABLE IF NOT EXISTS throughout.

'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'rootedpredictions';

const isTiDB = (process.env.DB_HOST || '').includes('tidbcloud.com');

const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  multipleStatements: true,
  ...(isTiDB && { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }),
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
        prediction_id   INT UNSIGNED DEFAULT NULL COMMENT 'Optional link to a RP prediction',
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
        ['home',        'Rooted Predictions - Free Football Predictions & Betting Tips Today',
                        'Get accurate free football predictions, VIP tips, and daily betting analysis covering 1,200+ leagues worldwide. Precision tips for Premier League, Champions League, and more.',
                        'football predictions today, free football tips, best prediction site, sure tips today, football betting tips'],
        ['predictions', 'Todays Football Predictions - All Leagues | Rooted Predictions',
                        'Browse todays free and VIP football predictions across all 1,200+ leagues. Filter by market, league, or continent. Over 2.5, BTTS, 1X2 tips updated daily.',
                        'football predictions today, free tips, over 2.5 goals, BTTS tips, accumulator tips'],
        ['pricing',     'VIP Football Tips - Subscribe from $4.89/month | Rooted Predictions',
                        'Unlock premium VIP football tips with high-confidence picks, early access, and Telegram alerts. Plans from $4.89/month. 3-day free trial available.',
                        'VIP football tips, premium predictions, best tipster subscription, football tips site'],
        ['leaderboard', 'Prediction Accuracy Leaderboard - Track Record | Rooted Predictions',
                        'See Rooted Predictions verified prediction accuracy stats and tipster performance leaderboard. Transparent results across all markets and leagues.',
                        'football prediction accuracy, tipster results, best prediction site record'],
        ['blog',        'Football Betting Guides & Match Previews | Rooted Predictions Blog',
                        'Expert football betting guides, match previews, and league analysis. Learn how to win football bets with data-driven insights from Rooted Predictions.',
                        'football betting guide, match preview, how to win football bets, league analysis'],
        ['about',       'About Rooted Predictions - Global Football Prediction Platform',
                        'Rooted Predictions is a global football prediction platform serving free and VIP tips powered by algorithm-generated predictions and API-Football data covering 1,200+ leagues.',
                        'about Rooted Predictions, football prediction platform, best tipster'],
        ['contact',     'Contact Rooted Predictions - Get in Touch',
                        'Contact the Rooted Predictions team for support, partnership enquiries, or feedback. We are here to help bettors worldwide win more.',
                        'contact Rooted Predictions, football tips support'],
        ['privacy',     'Privacy Policy | Rooted Predictions',
                        'Read the Rooted Predictions privacy policy. We are committed to protecting your personal data in compliance with GDPR and global data protection standards.',
                        'Rooted Predictions privacy policy, data protection'],
        ['terms',       'Terms of Service | Rooted Predictions',
                        'Read the Rooted Predictions terms of service. By using our platform you agree to these terms governing free and VIP prediction services.',
                        'Rooted Predictions terms of service, betting tips terms'],
        ['login',       'Login to Rooted Predictions - Access Your Dashboard',
                        'Log in to your Rooted Predictions account to access bookmarks, bet history, and VIP tips.',
                        'Rooted Predictions login'],
        ['register',    'Create a Free Account | Rooted Predictions',
                        'Register for a free Rooted Predictions account to save predictions, track your bets, and upgrade to VIP for premium tips.',
                        'Rooted Predictions register, free football tips account'],
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
  // 15. ACCURACY LOG — tracks every resolved prediction
  //     so we can measure real-world accuracy per market/band
  // ----------------------------------------------------------
  {
    name: 'Create prediction_accuracy_log table',
    sql: `
      CREATE TABLE IF NOT EXISTS prediction_accuracy_log (
        id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
        prediction_id   INT UNSIGNED    NOT NULL,
        market          VARCHAR(50)     NOT NULL DEFAULT '1X2',
        tip             VARCHAR(100)    NOT NULL DEFAULT '',
        confidence_band TINYINT UNSIGNED NOT NULL DEFAULT 50,
        league_id       INT UNSIGNED    DEFAULT NULL,
        result          ENUM('won','lost') NOT NULL,
        created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uniq_pred   (prediction_id),
        INDEX idx_market       (market),
        INDEX idx_band         (confidence_band),
        INDEX idx_league       (league_id),
        INDEX idx_result       (result)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 16. ACCURACY STATS — aggregated win-rate by market + band
  //     Updated by the accuracy service after every results sync
  // ----------------------------------------------------------
  {
    name: 'Create accuracy_stats table',
    sql: `
      CREATE TABLE IF NOT EXISTS accuracy_stats (
        id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
        market              VARCHAR(50)     NOT NULL DEFAULT '1X2',
        confidence_band     TINYINT UNSIGNED NOT NULL DEFAULT 50,
        league_id           INT UNSIGNED    DEFAULT NULL,
        total_predictions   INT UNSIGNED    NOT NULL DEFAULT 0,
        correct_predictions INT UNSIGNED    NOT NULL DEFAULT 0,
        accuracy_pct        DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
        last_updated        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uniq_band (market, confidence_band, league_id),
        INDEX idx_accuracy   (accuracy_pct DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },

  // ----------------------------------------------------------
  // 17. SEED: Default admin user
  //     Password: Admin@Afro! (bcrypt hash — CHANGE IMMEDIATELY)
  // ----------------------------------------------------------
  {
    name: 'Seed default admin user',
    sql: `
      INSERT IGNORE INTO users (name, email, password_hash, role, country, timezone)
      VALUES (
        'Rooted Predictions Admin',
        'admin@rootedpredictions.com',
        '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCKQlMOLJhBsKDWmPRUpNQ2',
        'admin',
        'United Kingdom',
        'Europe/London'
      );
    `,
  },

  // ----------------------------------------------------------
  // 18. Static pages table
  // ----------------------------------------------------------
  {
    name: 'Create static_pages table',
    sql: `
      CREATE TABLE IF NOT EXISTS static_pages (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        slug             VARCHAR(50)  NOT NULL UNIQUE,
        page_title       VARCHAR(200) NOT NULL,
        meta_description VARCHAR(300),
        hero_title       VARCHAR(200),
        hero_subtitle    TEXT,
        last_updated     DATE,
        content          LONGTEXT,
        extra            JSON,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
    await seedStaticPages(connection);
    console.log('[MIGRATE] Database is ready for Rooted Predictions.\n');
    console.log('---------------------------------------------------');
    console.log('Default admin credentials:');
    console.log('  Email:    admin@rootedpredictions.com');
    console.log('  Password: Admin@RP!');
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

// ============================================================
// STATIC PAGES SEEDER
// ============================================================
async function seedStaticPages(conn) {
  const pages = [
    {
      slug: 'about',
      page_title: 'About Rooted Predictions — Global Football Prediction Platform',
      meta_description: 'Rooted Predictions is a global football prediction platform serving free and VIP tips powered by algorithm-generated predictions and API-Football data covering 1,200+ leagues worldwide.',
      hero_title: 'Built for Bettors. Powered by Data.',
      hero_subtitle: 'Rooted Predictions is a global football prediction platform covering 1,200+ leagues, serving free and VIP tips to over 50,000 members worldwide.',
      last_updated: null,
      content: `<div style="margin-bottom:48px;"><h2 style="font-family:var(--font-head);font-size:1.8rem;font-weight:800;color:var(--text);margin-bottom:16px;">Our Mission</h2><p style="font-size:1rem;color:var(--text-soft);line-height:1.85;margin-bottom:16px;">Rooted Predictions was built with one goal: to give football bettors worldwide access to data-driven predictions that are transparent, accurate, and updated daily. We combine real-time data from over 1,200 competitions worldwide with a proprietary confidence-scoring algorithm to generate predictions that go beyond gut feeling.</p><p style="font-size:1rem;color:var(--text-soft);line-height:1.85;">We serve bettors across every continent — from Premier League fans in the UK to NPFL followers in Nigeria, ISL supporters in India, and MLS bettors in the United States. Every tip we publish comes with a confidence score, market analysis, and full transparency on what the data says.</p></div><div style="margin-bottom:48px;"><h2 style="font-family:var(--font-head);font-size:1.8rem;font-weight:800;color:var(--text);margin-bottom:24px;">How Our Algorithm Works</h2><div class="grid-2" style="gap:16px;"><div class="card" style="padding:24px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><div style="width:44px;height:44px;background:rgba(233,69,96,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="material-icons-round" style="color:var(--red);font-size:1.4rem;">show_chart</span></div><div style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;">Team Form — 35%</div></div><p style="font-size:0.875rem;color:var(--text-soft);line-height:1.7;">We analyse each team's last 5 matches — wins, losses, goals scored and conceded — to calculate a form weight. Home and away performance are tracked separately.</p></div><div class="card" style="padding:24px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><div style="width:44px;height:44px;background:rgba(233,69,96,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="material-icons-round" style="color:var(--red);font-size:1.4rem;">compare_arrows</span></div><div style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;">Head-to-Head — 25%</div></div><p style="font-size:0.875rem;color:var(--text-soft);line-height:1.7;">The last 10 meetings between the two sides are weighted, giving greater importance to more recent encounters and home-ground advantage.</p></div><div class="card" style="padding:24px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><div style="width:44px;height:44px;background:rgba(233,69,96,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="material-icons-round" style="color:var(--red);font-size:1.4rem;">sports_soccer</span></div><div style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;">Goal Averages — 20%</div></div><p style="font-size:0.875rem;color:var(--text-soft);line-height:1.7;">Home and away goal scoring and conceding averages across the season feed into market-specific models — especially for over/under and BTTS markets.</p></div><div class="card" style="padding:24px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><div style="width:44px;height:44px;background:rgba(233,69,96,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="material-icons-round" style="color:var(--red);font-size:1.4rem;">format_list_numbered</span></div><div style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;">Table Position — 20%</div></div><p style="font-size:0.875rem;color:var(--text-soft);line-height:1.7;">The gap in league standings between the two sides reflects relative quality and motivation. Top-half vs bottom-half matchups carry higher predictive weight.</p></div></div></div><div style="margin-bottom:48px;"><h2 style="font-family:var(--font-head);font-size:1.8rem;font-weight:800;color:var(--text);margin-bottom:16px;">Our Data Sources</h2><p style="font-size:1rem;color:var(--text-soft);line-height:1.85;margin-bottom:16px;">All prediction data is sourced from <strong>API-Football</strong>, one of the world's most comprehensive football data providers covering 1,200+ competitions in real time. We do not fabricate or estimate data — every stat is sourced from official match records and refreshed daily.</p><div style="display:flex;align-items:center;gap:12px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);"><span class="material-icons-round" style="color:var(--green);font-size:1.4rem;">verified</span><p style="font-size:0.875rem;color:var(--text-soft);">Our data pipeline syncs fresh fixture data every day at 06:00 UTC. Prediction results are updated within 30 minutes of each match finishing.</p></div></div><div style="background:rgba(233,69,96,0.05);border:1px solid rgba(233,69,96,0.2);border-radius:var(--radius-lg);padding:28px;margin-bottom:32px;"><div style="display:flex;align-items:flex-start;gap:14px;"><span class="material-icons-round" style="color:var(--red);font-size:1.6rem;flex-shrink:0;margin-top:2px;">warning</span><div><h3 style="font-family:var(--font-head);font-size:1.2rem;font-weight:700;color:var(--text);margin-bottom:8px;">Responsible Gambling Commitment</h3><p style="font-size:0.875rem;color:var(--text-soft);line-height:1.7;">Rooted Predictions provides predictions for informational and entertainment purposes only. We do not guarantee wins. Gambling involves risk and should only be done with money you can afford to lose. If you feel gambling is becoming a problem, please seek help at <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer" style="color:var(--red);">BeGambleAware.org</a>. You must be 18 or older to use this service.</p></div></div></div><div style="text-align:center;"><a href="/predictions.html" class="btn btn-primary btn-lg"><span class="material-icons-round">sports_soccer</span>View Today's Predictions</a></div>`,
      extra: JSON.stringify({
        stat_accuracy: '75.1%', stat_accuracy_label: 'All-Time Accuracy',
        stat_leagues: '1,200+', stat_leagues_label: 'Leagues Covered',
        stat_members: '50K+',   stat_members_label: 'Active Members',
        stat_countries: '20+',  stat_countries_label: 'Countries Served',
      }),
    },
    {
      slug: 'terms',
      page_title: 'Terms of Service | Rooted Predictions',
      meta_description: 'Read the Rooted Predictions terms of service. By using our platform you agree to these terms governing free and VIP prediction services.',
      hero_title: 'Terms of Service',
      hero_subtitle: null,
      last_updated: '2026-05-09',
      content: `<p style="margin-bottom:20px;">Please read these Terms of Service ("Terms") carefully before using the Rooted Predictions website at <strong>www.rootedpredictions.com</strong>. By accessing or using Rooted Predictions, you agree to be bound by these Terms.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">1. Acceptance of Terms</h2><p style="margin-bottom:20px;">By creating an account or using any part of the Rooted Predictions platform, you confirm that you are at least 18 years of age (or the legal gambling age in your jurisdiction, whichever is higher), and that you agree to these Terms in full.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">2. Nature of the Service</h2><p style="margin-bottom:12px;">Rooted Predictions provides football prediction tips for <strong>informational and entertainment purposes only</strong>. By using this service you acknowledge that:</p><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li>No prediction service can guarantee results. Past accuracy is not a guarantee of future performance.</li><li>You bear sole responsibility for any betting decisions you make based on our tips.</li><li>Rooted Predictions is not a licensed bookmaker and does not accept bets.</li><li>Sports betting may be illegal in your jurisdiction. It is your responsibility to ensure compliance with local laws.</li></ul><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">3. User Accounts</h2><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li>You are responsible for maintaining the confidentiality of your account credentials.</li><li>One account per person. Creating duplicate accounts is prohibited.</li><li>You must provide accurate registration information.</li><li>We reserve the right to suspend or terminate accounts that violate these Terms.</li></ul><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">4. VIP Subscriptions and Payments</h2><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li>VIP subscriptions are billed in advance on a monthly, quarterly, or annual basis.</li><li>The monthly plan includes a 3-day free trial. No charge is made until day 4.</li><li>Subscriptions renew automatically unless cancelled before the renewal date.</li><li>Refunds are not offered for partial billing periods unless required by law.</li><li>All prices are displayed in USD. Currency conversion is handled by your payment provider.</li><li>We reserve the right to change pricing with 30 days written notice to active subscribers.</li></ul><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">5. Prohibited Conduct</h2><p style="margin-bottom:12px;">You agree not to:</p><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li>Redistribute, sell, or share VIP content with non-members.</li><li>Use automated tools to scrape, copy, or republish site content.</li><li>Attempt to bypass content protection or access systems without authorisation.</li><li>Use the platform for any unlawful purpose.</li><li>Harass other users in comments or community spaces.</li></ul><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">6. Intellectual Property</h2><p style="margin-bottom:20px;">All content on Rooted Predictions — including predictions, analysis, design, logos, and software — is the property of Rooted Predictions and protected by copyright. Reproduction or redistribution without written permission is prohibited.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">7. Disclaimer of Warranties</h2><p style="margin-bottom:20px;">Rooted Predictions is provided "as is" without warranties of any kind. We do not warrant that predictions will be accurate, that the service will be uninterrupted, or that errors will be corrected. Your use of the service is at your own risk.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">8. Limitation of Liability</h2><p style="margin-bottom:20px;">To the maximum extent permitted by law, Rooted Predictions shall not be liable for any direct, indirect, incidental, or consequential losses arising from your use of our predictions or services, including but not limited to gambling losses.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">9. Responsible Gambling</h2><p style="margin-bottom:20px;">We are committed to promoting responsible gambling. If gambling is negatively affecting your life, please seek help immediately at <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer" style="color:var(--red);">BeGambleAware.org</a>. You must be 18 or older to use this service.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">10. Governing Law</h2><p style="margin-bottom:20px;">These Terms are governed by and construed in accordance with the laws of England and Wales. Disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">11. Contact</h2><p>For questions about these Terms, contact us at <a href="mailto:legal@rootedpredictions.com" style="color:var(--red);">legal@rootedpredictions.com</a>.</p>`,
      extra: null,
    },
    {
      slug: 'privacy',
      page_title: 'Privacy Policy | Rooted Predictions',
      meta_description: 'Read the Rooted Predictions privacy policy. We are committed to protecting your personal data in compliance with GDPR and global data protection standards.',
      hero_title: 'Privacy Policy',
      hero_subtitle: null,
      last_updated: '2026-05-09',
      content: `<p style="margin-bottom:20px;">Rooted Predictions ("we", "our", or "us") is committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, and protect information when you use our website at <strong>www.rootedpredictions.com</strong>.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">1. Information We Collect</h2><p style="margin-bottom:12px;">We collect the following categories of personal data:</p><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li><strong>Account data:</strong> Name, email address, country, and hashed password when you register.</li><li><strong>Usage data:</strong> Pages visited, predictions viewed, time on site, and browser/device information collected via server logs and analytics.</li><li><strong>Bet history:</strong> Stake, odds, result, and notes you voluntarily enter into the bet tracking tool.</li><li><strong>Payment data:</strong> Billing information is processed by Stripe or Paystack. We do not store card numbers on our servers.</li><li><strong>Communications:</strong> Content of messages sent via our contact form.</li></ul><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">2. How We Use Your Information</h2><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li>To provide and maintain your account and subscription.</li><li>To send transactional emails (registration confirmation, password reset, VIP confirmation).</li><li>To process payments via Stripe and Paystack.</li><li>To improve our prediction algorithm and site performance.</li><li>To comply with legal obligations.</li></ul><p style="margin-bottom:20px;">We do not sell your personal data to third parties. We do not use your data for advertising profiling.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">3. Cookies</h2><p style="margin-bottom:20px;">We use essential cookies to maintain your session and remember your dark/light mode preference. We also use Google Analytics cookies to understand site usage. You can disable cookies in your browser settings, but some functionality may be affected.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">4. Data Sharing</h2><p style="margin-bottom:12px;">We share your data only with the following trusted third parties:</p><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li><strong>Stripe</strong> — Payment processing (global subscriptions)</li><li><strong>Paystack</strong> — Payment processing (African users)</li><li><strong>Google Analytics</strong> — Anonymised usage statistics</li><li><strong>DigitalOcean</strong> — Hosting infrastructure</li></ul><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">5. Data Retention</h2><p style="margin-bottom:20px;">We retain your account data for as long as your account is active. If you delete your account, your personal data is removed within 30 days, except where we are required to retain it for legal or financial compliance purposes.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">6. Your Rights (GDPR)</h2><p style="margin-bottom:12px;">If you are based in the European Economic Area or the UK, you have the following rights:</p><ul style="list-style:disc;padding-left:24px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;"><li>Right to access your personal data</li><li>Right to correct inaccurate data</li><li>Right to erasure ("right to be forgotten")</li><li>Right to data portability</li><li>Right to object to processing</li></ul><p style="margin-bottom:20px;">To exercise any of these rights, email us at <a href="mailto:privacy@rootedpredictions.com" style="color:var(--red);">privacy@rootedpredictions.com</a>.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">7. Security</h2><p style="margin-bottom:20px;">All data is transmitted over HTTPS. Passwords are hashed with bcrypt and never stored in plain text. Payment data is handled entirely by PCI-compliant processors (Stripe, Paystack) and never stored on our servers.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">8. Changes to This Policy</h2><p style="margin-bottom:20px;">We may update this policy periodically. Material changes will be notified by email to registered users. Continued use of Rooted Predictions after changes constitutes acceptance of the updated policy.</p><h2 style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text);margin:32px 0 12px;">9. Contact</h2><p>For privacy-related enquiries, contact us at <a href="mailto:privacy@rootedpredictions.com" style="color:var(--red);">privacy@rootedpredictions.com</a> or via our <a href="/contact.html" style="color:var(--red);">contact page</a>.</p>`,
      extra: null,
    },
    {
      slug: 'contact',
      page_title: 'Contact Rooted Predictions — Get in Touch',
      meta_description: 'Contact the Rooted Predictions team for support, partnership enquiries, or feedback. We are here to help bettors worldwide win more.',
      hero_title: 'Contact Us',
      hero_subtitle: 'We typically respond within 24 hours',
      last_updated: null,
      content: null,
      extra: JSON.stringify({
        support_email: 'support@rootedpredictions.com',
        legal_email: 'legal@rootedpredictions.com',
        partners_email: 'partners@rootedpredictions.com',
        telegram_handle: '@rootedpredictions',
        telegram_url: 'https://t.me/rootedpredictions',
        support_hours_weekday: 'Monday – Friday: 08:00 – 20:00 UTC',
        support_hours_weekend: 'Saturday – Sunday: 09:00 – 18:00 UTC',
      }),
    },
  ];

  for (const p of pages) {
    try {
      await conn.execute(
        `INSERT IGNORE INTO static_pages
          (slug, page_title, meta_description, hero_title, hero_subtitle, last_updated, content, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.slug, p.page_title, p.meta_description, p.hero_title, p.hero_subtitle, p.last_updated, p.content, p.extra]
      );
      console.log(`[MIGRATE] ✓ Static page seeded: ${p.slug}`);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.log(`[MIGRATE] ↷ Static page already seeded: ${p.slug}`);
      } else {
        console.error(`[MIGRATE] ⚠ Failed to seed page ${p.slug}:`, err.message);
      }
    }
  }
}

runMigrations();
