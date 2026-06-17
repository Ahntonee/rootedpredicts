'use strict';
/**
 * Updates the About page content in the static_pages table.
 * Run on the server: node scripts/seed-about-page.js
 */
const db = require('../config/db');

const content = `
<article>

  <h2>What Is Rooted Predictions?</h2>
  <p>Rooted Predictions is a football prediction platform built for football fans, sports punters, and anyone who wants well-researched match insights before placing a bet. We provide free daily football predictions, in-depth match analysis, and VIP football tips covering over 1,200 leagues and competitions worldwide, from the English Premier League and UEFA Champions League to regional leagues across Africa, Asia, and the Americas.</p>
  <p>Our platform is built on one principle: give punters access to the same quality of data-driven analysis that professionals use, completely free of charge. Every tip published on Rooted Predictions is the result of structured research, not guesswork.</p>

  <h2>Our Mission</h2>
  <p>Our mission is to be the most trusted and accurate free football prediction site in the world. We believe that reliable football tips should not be locked behind expensive subscriptions or hidden in obscure corners of the internet. That is why Rooted Predictions publishes free predictions every single day, across multiple markets and leagues, for every type of punter.</p>
  <p>At the same time, we recognise that serious punters need more. For those who want handpicked high-confidence selections, detailed match previews, and exclusive insights, our VIP membership offers premium football predictions at an affordable price.</p>

  <h2>How Our Football Predictions Work</h2>
  <p>Every match analysis on Rooted Predictions follows a structured research process. Our predictions are not based on opinions or gut feeling. They are built on evidence. Here is how we approach each prediction:</p>

  <h3>Team Form Analysis</h3>
  <p>We study the recent form of both teams across their last five to ten matches, looking at wins, draws, losses, goals scored, and goals conceded. Consistent form is one of the strongest indicators of future performance.</p>

  <h3>Head-to-Head Records</h3>
  <p>Historical matchups between two sides often reveal patterns that are not visible in league tables. We analyse head-to-head records going back multiple seasons to identify tendencies specific to each fixture.</p>

  <h3>Squad Availability and Injuries</h3>
  <p>A team missing its first-choice goalkeeper or key striker is a very different team on paper. We factor in confirmed injury reports, suspensions, and international call-offs before finalising any prediction.</p>

  <h3>Tactical and Statistical Analysis</h3>
  <p>Beyond basic statistics, we look at pressing intensity, defensive organisation, set-piece threat, home and away performance splits, and market odds movement to build a complete picture of each match.</p>

  <h3>AI-Assisted Predictions</h3>
  <p>Our team uses AI-assisted football analysis tools to process large volumes of match data quickly and identify statistical patterns that human analysis might miss. The AI insights are reviewed and validated by our analysts before publication, ensuring accuracy without sacrificing human judgement.</p>

  <h2>What We Cover</h2>
  <p>Rooted Predictions covers football prediction markets across every major league and hundreds of smaller competitions. On our predictions page, you will find:</p>
  <ul>
    <li>Free Pick: our top recommended selection of the day</li>
    <li>Over and Under 1.5, 2.5, and 3.5 goals predictions</li>
    <li>Both Teams to Score (BTTS) tips</li>
    <li>Home win and away win predictions</li>
    <li>Double chance selections</li>
    <li>Accumulator tips (Acca)</li>
    <li>Banker of the Day: our highest-confidence single pick</li>
    <li>Correct score predictions</li>
  </ul>
  <p>All predictions are updated daily and include the recommended market, predicted outcome, and best available odds.</p>

  <h2>Free and VIP Football Predictions</h2>
  <p>Rooted Predictions offers two tiers of football tips to serve every type of punter.</p>
  <p><strong>Free predictions</strong> are available to every visitor with no registration required. These cover all major markets and are published every day across all major leagues. If you are looking for free football tips today, Rooted Predictions is the right place.</p>
  <p><strong>VIP predictions</strong> are our premium selections: handpicked high-confidence tips with detailed match analysis, exclusive markets, and priority publishing. VIP members also gain access to enhanced statistics and dedicated support. <a href="/pricing.html">View our VIP subscription plans</a>.</p>

  <h2>Why Punters Trust Rooted Predictions</h2>
  <p>In a space filled with sites that promise guaranteed wins, Rooted Predictions stands apart by being honest. Football is unpredictable. No prediction site, including ours, can guarantee results. What we can guarantee is that every tip we publish is backed by genuine research, clearly explained, and presented without misleading claims.</p>
  <p>Our track record, our transparent results history, and our growing community of over 50,000 members worldwide are the evidence. We let performance speak for itself.</p>

  <h2>Responsible Gambling</h2>
  <p>Rooted Predictions is committed to promoting responsible gambling. All content on this platform is provided for informational and entertainment purposes only. Our predictions should be treated as insights and opinions, not financial advice or guaranteed outcomes.</p>
  <p>We encourage all visitors to bet responsibly, set personal limits, and only stake amounts they can afford to lose. If gambling is affecting your wellbeing, please visit <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware.org</a> for free confidential support.</p>

  <h2>Join the Rooted Predictions Community</h2>
  <p>Rooted Predictions is more than a football tips website. It is a community of football fans who believe in smarter betting. Join thousands of members already using our daily predictions, follow us on <a href="https://t.me/rootedpredict" target="_blank" rel="noopener noreferrer">Telegram</a> for instant tip notifications, or <a href="/register.html">create a free account</a> to save predictions, track your results, and access your personal betting history.</p>
  <p>Football is the most popular sport in the world. At Rooted Predictions, we make sure you are always one step ahead.</p>

</article>
`;

const slug        = 'about';
const page_title  = 'About Rooted Predictions — Trusted Football Prediction Platform';
const meta_desc   = 'Learn about Rooted Predictions — a global football prediction platform offering free and VIP tips across 1,200+ leagues, powered by data analysis and AI-assisted research.';
const hero_title  = 'Built for Punters. Powered by Data.';
const hero_sub    = 'Rooted Predictions delivers free and VIP football tips across 1,200+ leagues worldwide, backed by structured research, not guesswork.';
const last_updated = '2026-06-17';

(async () => {
  try {
    const [result] = await db.query(
      `UPDATE static_pages
         SET page_title=?, meta_description=?, hero_title=?, hero_subtitle=?, last_updated=?, content=?, extra=NULL
       WHERE slug=?`,
      [page_title, meta_desc, hero_title, hero_sub, last_updated, content.trim(), slug]
    );
    if (result.affectedRows === 0) {
      await db.query(
        `INSERT INTO static_pages (slug, page_title, meta_description, hero_title, hero_subtitle, last_updated, content)
         VALUES (?,?,?,?,?,?,?)`,
        [slug, page_title, meta_desc, hero_title, hero_sub, last_updated, content.trim()]
      );
      console.log('About page INSERTED successfully.');
    } else {
      console.log('About page UPDATED successfully.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit();
  }
})();
