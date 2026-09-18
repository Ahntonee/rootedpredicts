'use strict';
const { amounts } = require('./planPricing');
function defaultAboutSections() {
  const money = value => 'NGN ' + value.toLocaleString('en-NG');
  return [
    { title: 'Frequently Asked Questions', content: '<h3>Are the football predictions free?</h3><p>Free predictions are available without a subscription. VIP membership provides access to premium selections.</p><h3>Which prediction markets are covered?</h3><p>Explore goals markets, both teams to score, home and away wins, double chance, and accumulator tips on our <a href="/predictions/free">prediction pages</a>.</p><h3>Are results guaranteed?</h3><p>No. Football is unpredictable, and every bet carries risk. Use the analysis to inform your own decisions and only stake what you can afford to lose.</p><h3>Where can I compare membership plans?</h3><p>Visit our <a href="/pricing.html">pricing page</a> for plan details, currency options, and subscription terms.</p>' },
    { title: 'Pricing and Membership', content: `<p><strong>Free access:</strong> Browse our free football predictions and match analysis.</p><ul><li><strong>Standard Plan:</strong> ${money(amounts.standard)} per month.</li><li><strong>Deluxe Plan:</strong> ${money(amounts.deluxe)} per month.</li></ul><p><a href="/pricing.html">Compare plans and view subscription details</a>.</p>` },
  ];
}
module.exports = { defaultAboutSections };
