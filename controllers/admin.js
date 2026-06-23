// controllers/admin.js
// Rooted Predictions — Admin controller
'use strict';

const bcrypt     = require('bcryptjs');
const db         = require('../config/db');
const slugify    = require('slugify');
const confidence = require('../services/confidence');
const { sanitiseText, generatePredictionSlug, generateBlogSlug } = require('../utils/helpers');

// ── Audit log helper (fire-and-forget — never throws into the response chain)
async function writeAudit(req, action, entityType, entityId, entityLabel, details) {
  try {
    const u    = req.user;
    const name = u.username || u.name || u.email;
    const role = u.admin_role || 'superadmin';
    const ip   = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null);
    await db.query(
      `INSERT INTO admin_audit_log
         (admin_id, admin_name, admin_role, action, entity_type, entity_id, entity_label, details, ip_address)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [u.id, name, role, action, entityType || null, entityId || null,
       entityLabel || null, details ? JSON.stringify(details) : null, ip]
    );
  } catch (e) {
    console.warn('[AUDIT] write failed:', e.message);
  }
}

// ── Dashboard stats
async function getStats(req, res) {
  try {
    const [
      [[users]], [[vips]], [[preds]], [[todayPreds]], [[pendingPreds]],
      [[wonPreds]], [[lostPreds]], [[subs]], [[blogs]], [[leagues]],
    ] = await Promise.all([
      db.query('SELECT COUNT(*) as c FROM users'),
      db.query("SELECT COUNT(*) as c FROM users WHERE role='vip'"),
      db.query('SELECT COUNT(*) as c FROM predictions'),
      db.query("SELECT COUNT(*) as c FROM predictions WHERE DATE(match_date)=CURDATE()"),
      db.query("SELECT COUNT(*) as c FROM predictions WHERE result='pending'"),
      db.query("SELECT COUNT(*) as c FROM predictions WHERE result='won'"),
      db.query("SELECT COUNT(*) as c FROM predictions WHERE result='lost'"),
      db.query("SELECT COUNT(*) as c FROM subscriptions WHERE status IN ('active','trialing')"),
      db.query('SELECT COUNT(*) as c FROM blog_posts WHERE is_published=1'),
      db.query('SELECT COUNT(*) as c FROM leagues WHERE is_active=1'),
    ]);
    const total = wonPreds.c + lostPreds.c;
    const accuracy = total > 0 ? Math.round((wonPreds.c / total) * 100) : 0;
    const [recentUsers] = await db.query(
      'SELECT id,name,email,role,country,created_at FROM users ORDER BY created_at DESC LIMIT 5'
    );
    const [recentPreds] = await db.query(
      `SELECT p.id,p.home_team,p.away_team,p.tip,p.result,p.match_date,p.visibility,
              l.name as league_name FROM predictions p
       LEFT JOIN leagues l ON p.league_id=l.id
       ORDER BY p.created_at DESC LIMIT 5`
    );
    res.json({ success:true, data:{
      users: users.c, vips: vips.c, predictions: preds.c,
      today_predictions: todayPreds.c, pending: pendingPreds.c,
      won: wonPreds.c, lost: lostPreds.c, accuracy,
      active_subscriptions: subs.c, published_blogs: blogs.c,
      active_leagues: leagues.c, recent_users: recentUsers, recent_predictions: recentPreds
    }});
  } catch(e) { res.status(500).json({ success:false, message: e.message }); }
}

// ── List predictions with filters
async function getPredictions(req, res) {
  try {
    const { page=1, limit=20, result, visibility, league, date } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const conditions = [], filterArgs = [];
    if (result)     { conditions.push('p.result=?');           filterArgs.push(result); }
    if (visibility) { conditions.push('p.visibility=?');       filterArgs.push(visibility); }
    if (league)     { conditions.push('p.league_id=?');        filterArgs.push(league); }
    if (date)       { conditions.push('DATE(p.match_date)=?'); filterArgs.push(date); }
    const WHERE = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const [[{total}]] = await db.query(
      `SELECT COUNT(*) as total FROM predictions p LEFT JOIN leagues l ON p.league_id=l.id${WHERE}`,
      filterArgs
    );
    const [rows] = await db.query(
      `SELECT p.*,COALESCE(p.category,'Free Pick') as category,l.name as league_name,l.logo_url as league_logo
       FROM predictions p LEFT JOIN leagues l ON p.league_id=l.id${WHERE}
       ORDER BY p.match_date DESC LIMIT ? OFFSET ?`,
      [...filterArgs, parseInt(limit), offset]
    );
    res.json({ success:true, data:{ predictions:rows, total:parseInt(total), page:parseInt(page), limit:parseInt(limit) }});
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Get single prediction by ID
async function getPrediction(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT p.*,l.name as league_name,l.logo_url as league_logo
       FROM predictions p LEFT JOIN leagues l ON p.league_id=l.id WHERE p.id=?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'Prediction not found' });
    res.json({ success:true, data:rows[0] });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Create prediction
async function createPrediction(req, res) {
  try {
    const { league_id,fixture_id,home_team,away_team,home_team_logo,away_team_logo,
            match_date,tip,market,odds,odds_data,confidence_score,visibility,category,analysis,
            home_form,away_form,h2h_summary,published } = req.body;
    if (!home_team||!away_team||!match_date||!tip||!market) {
      return res.status(400).json({ success:false, message:'Missing required fields' });
    }
    const oddsJson = odds_data && Object.keys(odds_data).length ? JSON.stringify(odds_data) : null;
    // Normalise datetime-local format ('2026-06-18T14:00') to MySQL DATETIME ('2026-06-18 14:00:00')
    const normalMatch = match_date ? match_date.replace('T', ' ').replace(/(\d{2}:\d{2})$/, '$1:00').slice(0, 19) : match_date;
    // Derive visibility from category if provided
    const derivedVis = category === 'Banker of the Day' ? 'vip' : (visibility || 'free');
    const leagueIdVal  = league_id  ? parseInt(league_id)  : null;
    const fixtureIdVal = fixture_id ? parseInt(fixture_id) : null;
    let leagueName = 'Match';
    if (leagueIdVal) {
      const [lRows] = await db.query('SELECT name FROM leagues WHERE id=?',[leagueIdVal]);
      if (lRows.length) leagueName = lRows[0].name;
    }
    let slug = slugify(`${leagueName} ${home_team} vs ${away_team} ${match_date.split('T')[0]}`,{ lower:true, strict:true });
    const [existing] = await db.query('SELECT id FROM predictions WHERE slug=?',[slug]);
    if (existing.length) slug = slug+'-'+Date.now();
    const [ins] = await db.query(
      `INSERT INTO predictions (fixture_id,league_id,home_team,away_team,home_team_logo,away_team_logo,
        match_date,tip,market,odds,odds_data,confidence_score,visibility,category,analysis,home_form,away_form,
        h2h_summary,slug,result,published_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      [fixtureIdVal,leagueIdVal,sanitiseText(home_team),sanitiseText(away_team),home_team_logo||null,
       away_team_logo||null,normalMatch,sanitiseText(tip),sanitiseText(market),
       odds||null,oddsJson,confidence_score||null,derivedVis,category||null,analysis||null,
       home_form||null,away_form||null,h2h_summary||null,slug,
       published ? new Date() : null, req.user.id]
    );
    // Auto-score if no manual confidence was provided
    let finalScore = confidence_score || null;
    if (!confidence_score) {
      try {
        const { score } = await confidence.scorePrediction(db, ins.insertId);
        finalScore = score;
      } catch(_) { /* non-fatal — score can be set manually */ }
    }
    writeAudit(req, 'create', 'prediction', ins.insertId,
      `${sanitiseText(home_team)} vs ${sanitiseText(away_team)}`,
      { tip, market, category, match_date });
    res.status(201).json({ success:true, data:{ id:ins.insertId, slug, confidence_score: finalScore }, message:'Prediction created' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Update prediction
async function updatePrediction(req, res) {
  try {
    const { id } = req.params;
    const { fixture_id,league_id,home_team,away_team,match_date,tip,market,odds,odds_data,
            confidence_score,visibility,category,result,analysis,
            home_form,away_form,h2h_summary,published } = req.body;
    const updates=[]; const args=[];
    if (fixture_id !== undefined) { updates.push('fixture_id=?'); args.push(fixture_id ? parseInt(fixture_id) : null); }
    if (league_id)        { updates.push('league_id=?');        args.push(league_id); }
    if (home_team)        { updates.push('home_team=?');        args.push(sanitiseText(home_team)); }
    if (away_team)        { updates.push('away_team=?');        args.push(sanitiseText(away_team)); }
    if (match_date)       { updates.push('match_date=?');       args.push(match_date.replace('T', ' ').replace(/(\d{2}:\d{2})$/, '$1:00').slice(0, 19)); }
    if (tip)              { updates.push('tip=?');              args.push(sanitiseText(tip)); }
    if (market)           { updates.push('market=?');           args.push(sanitiseText(market)); }
    if (odds!==undefined) { updates.push('odds=?');             args.push(odds); }
    if (odds_data!==undefined) { updates.push('odds_data=?');   args.push(odds_data && Object.keys(odds_data).length ? JSON.stringify(odds_data) : null); }
    if (confidence_score) { updates.push('confidence_score=?'); args.push(confidence_score); }
    // Category → visibility: Banker of the Day = vip, rest = free
    if (category !== undefined) {
      updates.push('category=?'); args.push(category||null);
      const derivedVis = category === 'Banker of the Day' ? 'vip' : 'free';
      updates.push('visibility=?'); args.push(derivedVis);
    } else if (visibility) {
      updates.push('visibility=?'); args.push(visibility);
    }
    if (result)           { updates.push('result=?');           args.push(result); }
    if (analysis !== undefined) { updates.push('analysis=?');   args.push(analysis||null); }
    if (home_form)        { updates.push('home_form=?');        args.push(home_form); }
    if (away_form)        { updates.push('away_form=?');        args.push(away_form); }
    if (h2h_summary)      { updates.push('h2h_summary=?');      args.push(h2h_summary); }
    if (published===true) { updates.push('published_at=COALESCE(published_at,NOW())'); }
    if (published===false){ updates.push('published_at=NULL'); }
    if (!updates.length)  return res.status(400).json({ success:false, message:'Nothing to update' });
    updates.push('updated_by=?'); args.push(req.user.id);
    updates.push('updated_at=NOW()'); args.push(id);
    await db.query(`UPDATE predictions SET ${updates.join(',')} WHERE id=?`, args);
    writeAudit(req, 'update', 'prediction', parseInt(id), null,
      { fields: updates.filter(u => !u.includes('NOW') && !u.includes('updated_by')).map(u => u.split('=')[0]) });
    res.json({ success:true, message:'Prediction updated' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Delete prediction
async function deletePrediction(req, res) {
  try {
    const [rows] = await db.query('SELECT home_team, away_team, match_date FROM predictions WHERE id=?', [req.params.id]);
    const label = rows.length ? `${rows[0].home_team} vs ${rows[0].away_team} (${String(rows[0].match_date).split('T')[0]})` : null;
    await db.query('DELETE FROM predictions WHERE id=?',[req.params.id]);
    writeAudit(req, 'delete', 'prediction', parseInt(req.params.id), label, null);
    res.json({ success:true, message:'Prediction deleted' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Score a single prediction via algorithm
async function scorePrediction(req, res) {
  try {
    const { score, breakdown } = await confidence.scorePrediction(db, req.params.id);
    res.json({ success:true, data:{ score, breakdown }, message:`Confidence score set to ${score}` });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Score all pending predictions
async function scoreAllPredictions(req, res) {
  try {
    const updated = await confidence.scoreAllPending(db);
    res.json({ success:true, data:{ updated }, message:`${updated} predictions scored` });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Preview score from form body (no DB write)
async function previewScore(req, res) {
  try {
    const { score, breakdown } = confidence.score(req.body);
    res.json({ success:true, data:{ score, breakdown } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── List users
async function getUsers(req, res) {
  try {
    const { page=1, limit=20, role, country, search } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    const conditions = [], filterArgs = [];
    if (role)    { conditions.push('role=?');                            filterArgs.push(role); }
    if (country) { conditions.push('country=?');                        filterArgs.push(country); }
    if (search)  { conditions.push('(name LIKE ? OR email LIKE ?)');    filterArgs.push(`%${search}%`, `%${search}%`); }
    const WHERE = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const [[{total}]] = await db.query(
      `SELECT COUNT(*) as total FROM users${WHERE}`, filterArgs
    );
    const [rows] = await db.query(
      `SELECT id,name,email,role,country,is_banned,created_at FROM users${WHERE}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...filterArgs, parseInt(limit), offset]
    );
    res.json({ success:true, data:{ users:rows, total:parseInt(total), page:parseInt(page) }});
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Update user role / ban
async function updateUser(req, res) {
  try {
    const { role, is_banned } = req.body;
    const updates=[]; const args=[];
    if (role)           { updates.push('role=?');      args.push(role); }
    if (is_banned!==undefined){ updates.push('is_banned=?'); args.push(is_banned?1:0); }
    if (!updates.length) return res.status(400).json({ success:false, message:'Nothing to update' });
    updates.push('updated_at=NOW()'); args.push(req.params.id);
    await db.query(`UPDATE users SET ${updates.join(',')} WHERE id=?`,args);
    writeAudit(req, 'update', 'user', parseInt(req.params.id), null, req.body);
    res.json({ success:true, message:'User updated' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── League management
async function getLeagues(req, res) {
  try {
    const [rows] = await db.query('SELECT * FROM leagues ORDER BY is_popular DESC, continent ASC, name ASC');
    res.json({ success:true, data:rows });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

async function updateLeague(req, res) {
  try {
    const { is_active, is_popular } = req.body;
    const updates=[]; const args=[];
    if (is_active!==undefined)  { updates.push('is_active=?');  args.push(is_active?1:0); }
    if (is_popular!==undefined) { updates.push('is_popular=?'); args.push(is_popular?1:0); }
    if (!updates.length) return res.status(400).json({ success:false, message:'Nothing to update' });
    updates.push('updated_at=NOW()'); args.push(req.params.id);
    await db.query(`UPDATE leagues SET ${updates.join(',')} WHERE id=?`,args);
    res.json({ success:true, message:'League updated' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Blog management
async function getBlogPosts(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT bp.id,bp.title,bp.slug,bp.category,bp.is_published,bp.published_at,
              u.name as author_name FROM blog_posts bp
       LEFT JOIN users u ON bp.author_id=u.id ORDER BY bp.created_at DESC`
    );
    res.json({ success:true, data:rows });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Get single blog post by ID
async function getBlogPost(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT bp.*,u.name as author_name FROM blog_posts bp
       LEFT JOIN users u ON bp.author_id=u.id WHERE bp.id=?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'Post not found' });
    res.json({ success:true, data:rows[0] });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

async function createBlogPost(req, res) {
  try {
    const { title,content,excerpt,category,featured_image,featured_image_alt,meta_title,meta_description,keywords,published } = req.body;
    if (!title||!content) return res.status(400).json({ success:false, message:'Title and content required' });
    let slug = generateBlogSlug(title);
    const [ex] = await db.query('SELECT id FROM blog_posts WHERE slug=?',[slug]);
    if (ex.length) slug = slug+'-'+Date.now();
    const [ins] = await db.query(
      `INSERT INTO blog_posts (title,slug,content,excerpt,category,featured_image,featured_image_alt,meta_title,meta_description,
        keywords,author_id,is_published,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sanitiseText(title),slug,content,excerpt||null,category||null,featured_image||null,featured_image_alt||null,
       meta_title||null,meta_description||null,keywords||null,req.user.id,
       published?1:0, published?new Date():null]
    );
    writeAudit(req, 'create', 'blog_post', ins.insertId, sanitiseText(title), { category, published });
    res.status(201).json({ success:true, data:{ id:ins.insertId, slug }, message:'Post created' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

async function updateBlogPost(req, res) {
  try {
    const { title,content,excerpt,category,featured_image,featured_image_alt,meta_title,meta_description,keywords,published } = req.body;
    const updates=[]; const args=[];
    if (title)            { updates.push('title=?');            args.push(sanitiseText(title)); }
    if (content)          { updates.push('content=?');          args.push(content); }
    if (excerpt!==undefined)             { updates.push('excerpt=?');             args.push(excerpt||null); }
    if (category!==undefined)            { updates.push('category=?');            args.push(category||null); }
    if (featured_image!==undefined)      { updates.push('featured_image=?');      args.push(featured_image||null); }
    if (featured_image_alt!==undefined)  { updates.push('featured_image_alt=?');  args.push(featured_image_alt||null); }
    if (meta_title)       { updates.push('meta_title=?');       args.push(meta_title); }
    if (meta_description) { updates.push('meta_description=?'); args.push(meta_description); }
    if (keywords)         { updates.push('keywords=?');         args.push(keywords); }
    if (published===true) { updates.push('is_published=1','published_at=NOW()'); }
    if (published===false){ updates.push('is_published=0'); }
    if (!updates.length)  return res.status(400).json({ success:false, message:'Nothing to update' });
    updates.push('updated_at=NOW()'); args.push(req.params.id);
    await db.query(`UPDATE blog_posts SET ${updates.join(',')} WHERE id=?`,args);
    writeAudit(req, 'update', 'blog_post', parseInt(req.params.id), title || null,
      { fields: updates.filter(u => !u.includes('NOW')).map(u => u.split('=')[0]) });
    res.json({ success:true, message:'Post updated' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

async function deleteBlogPost(req, res) {
  try {
    const [rows] = await db.query('SELECT title FROM blog_posts WHERE id=?', [req.params.id]);
    const label = rows.length ? rows[0].title : null;
    await db.query('DELETE FROM blog_posts WHERE id=?',[req.params.id]);
    writeAudit(req, 'delete', 'blog_post', parseInt(req.params.id), label, null);
    res.json({ success:true, message:'Post deleted' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── SEO settings
async function getSeoSettings(req, res) {
  try {
    const [rows] = await db.query('SELECT * FROM seo_settings ORDER BY page ASC');
    res.json({ success:true, data:rows });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

async function updateSeoSettings(req, res) {
  try {
    const { meta_title,meta_description,og_image,keywords } = req.body;
    await db.query(
      `UPDATE seo_settings SET meta_title=?,meta_description=?,og_image=?,keywords=?,updated_at=NOW() WHERE page=?`,
      [meta_title||null,meta_description||null,og_image||null,keywords||null,req.params.page]
    );
    res.json({ success:true, message:'SEO settings saved' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
}

// ── Prediction form helpers ─────────────────────────────────
// Leagues that actually have fixtures (for the New Prediction dropdown)
async function getFormLeagues(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT l.id, l.api_league_id, l.name, l.country
       FROM leagues l
       JOIN predictions p ON p.league_id = l.id
       GROUP BY l.id, l.api_league_id, l.name, l.country
       ORDER BY l.name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// Fixtures for a league (optionally a date) — drives team lists + away auto-fill
async function getLeagueFixtures(req, res) {
  try {
    const leagueId = parseInt(req.query.league_id);
    if (!leagueId) return res.status(400).json({ success: false, message: 'league_id required' });
    let sql  = `SELECT fixture_id, home_team, away_team, match_date
                FROM predictions WHERE league_id = ?`;
    const args = [leagueId];
    if (req.query.date) { sql += ' AND DATE(match_date) = ?'; args.push(req.query.date); }
    sql += ' ORDER BY match_date ASC';
    const [rows] = await db.query(sql, args);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// Real bookmaker odds for a single fixture (for the prediction form)
async function getFixtureOdds(req, res) {
  try {
    const fixtureId = parseInt(req.query.fixture_id);
    if (!fixtureId) return res.status(400).json({ success: false, message: 'fixture_id required' });
    const api  = require('../services/apiFootball');
    const odds = await api.fetchFixtureOdds(fixtureId).catch(() => null);
    res.json({ success: true, data: odds });   // data may be null if no odds published
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ── Homepage stat overrides (live value by default, admin can override)
async function getSiteStats(req, res) {
  try {
    const [[acc]] = await db.query(
      `SELECT ROUND(SUM(result='won')/NULLIF(SUM(result IN('won','lost')),0)*100,1) a
       FROM predictions WHERE published_at IS NOT NULL`
    );
    const [[lg]] = await db.query(
      `SELECT COUNT(DISTINCT league_id) c FROM predictions WHERE published_at IS NOT NULL`
    );
    const [[mb]] = await db.query('SELECT COUNT(*) c FROM users');
    const [[pr]] = await db.query("SELECT COUNT(*) c FROM predictions WHERE published_at IS NOT NULL");

    const liveMap = {
      accuracy:        acc.a != null ? acc.a + '%' : 'New',
      leagues_covered: String(lg.c),
      members:         String(mb.c),
      predictions:     String(pr.c),
    };

    let rows = [];
    try {
      [rows] = await db.query(
        'SELECT metric_key,label,override_value FROM site_stat_overrides ORDER BY sort_order ASC'
      );
    } catch (_) { /* table may not exist yet — return live values only */ }
    const data = rows.length
      ? rows.map(r => ({
          key:      r.metric_key,
          label:    r.label,
          live:     liveMap[r.metric_key] != null ? liveMap[r.metric_key] : '—',
          override: r.override_value || '',
        }))
      : Object.entries(liveMap).map(([k, v]) => ({ key: k, label: k, live: v, override: '' }));
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

async function updateSiteStats(req, res) {
  try {
    const updates = req.body || {};   // { metric_key: 'override string or empty', ... }
    for (const [key, val] of Object.entries(updates)) {
      const clean = (val == null || String(val).trim() === '') ? null : String(val).trim().slice(0, 60);
      await db.query(
        `INSERT INTO site_stat_overrides (metric_key, label, override_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE override_value = VALUES(override_value), updated_at = NOW()`,
        [key, key, clean]
      );
    }
    res.json({ success: true, message: 'Homepage stats saved' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ── Audit log ──────────────────────────────────────────────────
async function getAuditLog(req, res) {
  try {
    const { page = 1, limit = 50, action, entity_type, admin_id, date_from, date_to } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = 'SELECT * FROM admin_audit_log WHERE 1=1';
    const args = [];
    if (action)      { sql += ' AND action=?';      args.push(action); }
    if (entity_type) { sql += ' AND entity_type=?'; args.push(entity_type); }
    if (admin_id)    { sql += ' AND admin_id=?';    args.push(parseInt(admin_id)); }
    if (date_from)   { sql += ' AND DATE(created_at)>=?'; args.push(date_from); }
    if (date_to)     { sql += ' AND DATE(created_at)<=?'; args.push(date_to); }
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const [[{ total }]] = await db.query(countSql, args);
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const [rows] = await db.query(sql, [...args, parseInt(limit), offset]);
    res.json({ success: true, data: { logs: rows, total: parseInt(total), page: parseInt(page) } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ── Admin profile (self) ───────────────────────────────────────
async function getProfile(req, res) {
  try {
    const [rows] = await db.query(
      'SELECT id, name, username, email, role, admin_role, created_at FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    // Recent activity for this admin
    let recentActivity = [];
    try {
      const [logs] = await db.query(
        'SELECT action, entity_type, entity_label, created_at FROM admin_audit_log WHERE admin_id=? ORDER BY created_at DESC LIMIT 10',
        [req.user.id]
      );
      recentActivity = logs;
    } catch (_) {}
    res.json({ success: true, data: { ...rows[0], recent_activity: recentActivity } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

async function updateProfile(req, res) {
  try {
    const { name, username } = req.body;
    const updates = []; const args = [];
    if (name)     { updates.push('name=?');     args.push(sanitiseText(name).slice(0, 100)); }
    if (username) {
      // Validate username: alphanumeric + underscores only
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        return res.status(400).json({ success: false, message: 'Username must be 3–30 characters: letters, numbers, underscores only.' });
      }
      updates.push('username=?'); args.push(username.toLowerCase());
    }
    if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    updates.push('updated_at=NOW()'); args.push(req.user.id);
    await db.query(`UPDATE users SET ${updates.join(',')} WHERE id=?`, args);
    res.json({ success: true, message: 'Profile updated' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'That username is already taken.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: 'current_password and new_password are required.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }
    const [rows] = await db.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found.' });
    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    const newHash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash=?, updated_at=NOW() WHERE id=?', [newHash, req.user.id]);
    writeAudit(req, 'password_change', 'admin_account', req.user.id, req.user.username || req.user.name, null);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// ── Admin account management (superadmin only) ─────────────────
async function getAdmins(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT id, name, username, email, admin_role, created_at,
              (SELECT created_at FROM admin_audit_log WHERE admin_id=u.id ORDER BY created_at DESC LIMIT 1) as last_active
       FROM users u WHERE role='admin' ORDER BY created_at ASC`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

async function createAdminAccount(req, res) {
  try {
    const { name, username, email, password, admin_role = 'editor' } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email, and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }
    if (!['superadmin', 'editor', 'viewer'].includes(admin_role)) {
      return res.status(400).json({ success: false, message: 'Invalid admin_role.' });
    }
    if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ success: false, message: 'Username must be 3–30 characters: letters, numbers, underscores only.' });
    }
    const [existing] = await db.query('SELECT id FROM users WHERE email=?', [email.toLowerCase()]);
    if (existing.length) return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
    const hash = await bcrypt.hash(password, 12);
    const [ins] = await db.query(
      `INSERT INTO users (name, username, email, password_hash, role, admin_role) VALUES (?,?,?,?,?,?)`,
      [sanitiseText(name).slice(0, 100), username ? username.toLowerCase() : null,
       email.toLowerCase(), hash, 'admin', admin_role]
    );
    writeAudit(req, 'create', 'admin_account', ins.insertId, username || name, { admin_role });
    res.status(201).json({ success: true, data: { id: ins.insertId }, message: 'Admin account created.' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email or username already in use.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

async function updateAdminAccount(req, res) {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Use My Profile to update your own account.' });
    }
    const { name, username, admin_role, password } = req.body;
    const updates = []; const args = [];
    if (name)       { updates.push('name=?');       args.push(sanitiseText(name).slice(0, 100)); }
    if (username)   {
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        return res.status(400).json({ success: false, message: 'Invalid username format.' });
      }
      updates.push('username=?'); args.push(username.toLowerCase());
    }
    if (admin_role) {
      if (!['superadmin', 'editor', 'viewer'].includes(admin_role)) {
        return res.status(400).json({ success: false, message: 'Invalid admin_role.' });
      }
      updates.push('admin_role=?'); args.push(admin_role);
    }
    if (password) {
      if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
      const hash = await bcrypt.hash(password, 12);
      updates.push('password_hash=?'); args.push(hash);
    }
    if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update.' });
    updates.push('updated_at=NOW()'); args.push(id);
    await db.query(`UPDATE users SET ${updates.join(',')} WHERE id=? AND role='admin'`, args);
    writeAudit(req, 'update', 'admin_account', parseInt(id), username || name || null,
      { fields: updates.filter(u => !u.includes('NOW') && !u.includes('password')).map(u => u.split('=')[0]) });
    res.json({ success: true, message: 'Admin account updated.' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Username already taken.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

async function deleteAdminAccount(req, res) {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    const [rows] = await db.query("SELECT name, username FROM users WHERE id=? AND role='admin'", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Admin not found.' });
    await db.query("DELETE FROM users WHERE id=? AND role='admin'", [id]);
    writeAudit(req, 'delete', 'admin_account', parseInt(id), rows[0].username || rows[0].name, null);
    res.json({ success: true, message: 'Admin account deleted.' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

module.exports = {
  getStats, getPredictions, getPrediction, createPrediction, updatePrediction, deletePrediction,
  scorePrediction, scoreAllPredictions, previewScore,
  getUsers, updateUser, getLeagues, updateLeague,
  getBlogPosts, getBlogPost, createBlogPost, updateBlogPost, deleteBlogPost,
  getSeoSettings, updateSeoSettings,
  getSiteStats, updateSiteStats,
  getFormLeagues, getLeagueFixtures, getFixtureOdds,
  getAuditLog,
  getProfile, updateProfile, changePassword,
  getAdmins, createAdminAccount, updateAdminAccount, deleteAdminAccount,
};
