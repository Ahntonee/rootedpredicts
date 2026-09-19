(function () {
  'use strict';
  var countries = { NG:'NGN', US:'USD', GB:'GBP', GH:'GHS', KE:'KES', ZA:'ZAR', IN:'INR', AU:'AUD', CA:'CAD', NZ:'NZD', JP:'JPY', CN:'CNY', PH:'PHP', ID:'IDR', PK:'PKR', BD:'BDT', AE:'AED', SA:'SAR', EG:'EGP', UG:'UGX', TZ:'TZS', RW:'RWF', ZM:'ZMW', BW:'BWP', MA:'MAD', TN:'TND', DZ:'DZD', CM:'XAF', SN:'XOF', CI:'XOF', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', PT:'EUR', NL:'EUR', BE:'EUR', IE:'EUR', AT:'EUR', FI:'EUR', GR:'EUR', CY:'EUR', MT:'EUR', EE:'EUR', LV:'EUR', LT:'EUR', SK:'EUR', SI:'EUR', HR:'EUR', LU:'EUR', CH:'CHF', SE:'SEK', NO:'NOK', DK:'DKK', PL:'PLN', CZ:'CZK', HU:'HUF', RO:'RON', TR:'TRY', BR:'BRL', MX:'MXN', AR:'ARS', CL:'CLP', CO:'COP', SG:'SGD', MY:'MYR', TH:'THB', VN:'VND', KR:'KRW', HK:'HKD', TW:'TWD', IL:'ILS', QA:'QAR', KW:'KWD', BH:'BHD', OM:'OMR' };
  Object.assign(countries, {"DZ": "DZD", "AO": "AOA", "BJ": "XOF", "BW": "BWP", "BF": "XOF", "BI": "BIF", "CV": "CVE", "CM": "XAF", "CF": "XAF", "TD": "XAF", "KM": "KMF", "CG": "XAF", "CD": "CDF", "CI": "XOF", "DJ": "DJF", "EG": "EGP", "GQ": "XAF", "ER": "ERN", "SZ": "SZL", "ET": "ETB", "GA": "XAF", "GM": "GMD", "GH": "GHS", "GN": "GNF", "GW": "XOF", "KE": "KES", "LS": "LSL", "LR": "LRD", "LY": "LYD", "MG": "MGA", "MW": "MWK", "ML": "XOF", "MR": "MRU", "MU": "MUR", "MA": "MAD", "MZ": "MZN", "NA": "NAD", "NE": "XOF", "NG": "NGN", "RW": "RWF", "ST": "STN", "SN": "XOF", "SC": "SCR", "SL": "SLE", "SO": "SOS", "ZA": "ZAR", "SS": "SSP", "SD": "SDG", "TZ": "TZS", "TG": "XOF", "TN": "TND", "UG": "UGX", "ZM": "ZMW", "ZW": "ZWG", "EH": "MAD"});
  var zones = { 'Africa/Lagos':'NG', 'Africa/Accra':'GH', 'Africa/Nairobi':'KE', 'Africa/Johannesburg':'ZA', 'Europe/London':'GB', 'Asia/Kolkata':'IN', 'Asia/Calcutta':'IN', 'America/New_York':'US', 'America/Chicago':'US', 'America/Denver':'US', 'America/Los_Angeles':'US', 'America/Toronto':'CA', 'America/Vancouver':'CA', 'Australia/Sydney':'AU', 'Australia/Perth':'AU' };
  var select = document.getElementById('pricing-currency');
  if (!select) {
    var vipPrice = document.getElementById('vip-local-price');
    if (!vipPrice) return;
    (window.sessionUserPromise || Promise.resolve(null)).then(async function(user) {
      var currency = countries[user && user.country];
      try {
        currency = currency || countries[zones[Intl.DateTimeFormat().resolvedOptions().timeZone]] || countries[new Intl.Locale(navigator.language).region] || 'USD';
        var savedCurrency = localStorage.getItem('pricing_currency');
        if (Object.values(countries).includes(savedCurrency)) currency = savedCurrency;
      } catch (_) { currency = currency || 'USD'; }
      try {
        var data = await quote(currency);
        vipPrice.textContent = 'From ' + money(data.plans.standard.amount, data.currency) + '/month';
      } catch (_) { vipPrice.textContent = currency === 'NGN' ? 'From NGN 15,000/month' : 'From USD 30/month'; }
    });
    return;
  }
  var version = 0, nigerian = false;
  var choices = Array.from(new Set(Object.values(countries))).sort();
  var names;
  try { names = new Intl.DisplayNames(navigator.languages, { type:'currency' }); } catch (_) {}
  select.textContent = '';
  choices.forEach(function (code) {
    var option = document.createElement('option');
    option.value = code;
    option.textContent = code + (names ? ' - ' + names.of(code) : '');
    select.appendChild(option);
  });
  function money(amount, currency) {
    return new Intl.NumberFormat(navigator.languages, {
      style:'currency', currency:currency, currencyDisplay:'code',
      ...(Number.isInteger(Number(amount)) ? { minimumFractionDigits: 0 } : {}),
    }).format(amount);
  }
  function duration() { var el = document.getElementById('pricing-duration'); return el ? el.value : 'monthly'; }
  async function quote(currency, period) {
    var response = await fetch('/api/subscriptions/pricing?currency=' + encodeURIComponent(currency) + '&duration=' + (period || duration()));
    var json = await response.json();
    if (!response.ok || !json.success) throw new Error('Prices unavailable');
    return json.data;
  }
  function render(data, other) {
    select.value = data.currency;
    var biweekly = duration() === 'biweekly';
    if (document.querySelectorAll) {
      document.querySelectorAll('.pricing-card .pricing-period').forEach(function(el) { el.textContent = biweekly ? 'every 2 weeks' : 'per month'; });
      document.querySelectorAll('.pricing-card .trial-note').forEach(function(el) { el.textContent = biweekly ? '14 days of access.' : '30 days of access.'; });
    }
    Object.keys(data.plans).forEach(function (plan) {
      var price = data.plans[plan];
      var usd = price.usd == null ? (plan === 'standard' ? 30 : 45) * (biweekly ? 0.5 : 1) : price.usd;
      document.getElementById('sub-' + plan + '-price').textContent = nigerian ? money(price.amount, 'NGN') : money(usd, 'USD');
      var local = document.getElementById('sub-' + plan + '-local-price');
      if (local) local.textContent = !nigerian && data.currency !== 'USD' ? money(price.amount, data.currency) : '';
      var billing = document.getElementById('bank-' + plan + '-duration');
      if (billing && billing.options) Array.from(billing.options).forEach(function(option) {
        var period = option.value;
        var periodData = period === duration() ? data : other;
        if (!periodData) return;
        var periodPrice = periodData.plans[plan];
        var dollars = periodPrice.usd == null ? (plan === 'standard' ? 30 : 45) * (period === 'biweekly' ? 0.5 : 1) : periodPrice.usd;
        var label = nigerian ? money(periodPrice.amount, 'NGN') : money(dollars, 'USD') + (periodData.currency !== 'USD' ? ' / ' + money(periodPrice.amount, periodData.currency) : '');
        option.textContent = (period === 'biweekly' ? 'Bi-weekly' : 'Monthly') + ' ? ' + label;
      });
    });
  }
  function fallback(period) {
    var factor = period === 'biweekly' ? 0.5 : 1;
    return { currency: nigerian ? 'NGN' : 'USD', plans: {
      standard: { amount: (nigerian ? 15000 : 30) * factor, usd: 30 * factor },
      deluxe: { amount: (nigerian ? 25000 : 45) * factor, usd: 45 * factor }
    } };
  }
  async function update() {
    var request = ++version;
    var period = duration();
    var otherPeriod = period === 'monthly' ? 'biweekly' : 'monthly';
    // Country determines the price schedule; selecting NGN cannot change a foreign account's price.
    if (nigerian) select.value = 'NGN';
    else if (select.value === 'NGN') select.value = 'USD';
    try {
      var results = await Promise.all([quote(select.value, period), quote(select.value, otherPeriod)]);
      if (request === version) render(results[0], results[1]);
    } catch (_) {
      if (request === version) render(fallback(period), fallback(otherPeriod));
    }
  }
  var durationSelect = document.getElementById('pricing-duration');
  if (durationSelect) durationSelect.addEventListener('change', update);
  select.addEventListener('change', function () {
    try { localStorage.setItem('pricing_currency', select.value); } catch (_) {}
    update();
  });
  window.PricingCurrency = { setCountry: function (country) {
    var code = String(country || '').trim().toUpperCase();
    var currency = countries[code];
    if (!currency && code) {
      try {
        var regions = new Intl.DisplayNames(['en'], { type: 'region' });
        var match = Object.keys(countries).find(function(key) { return regions.of(key).toUpperCase() === code; });
        currency = countries[match] || 'USD';
      } catch (_) { currency = code === 'NIGERIA' ? 'NGN' : 'USD'; }
    }
    if (currency) {
      nigerian = currency === 'NGN';
      select.disabled = nigerian;
      if (select.options) Array.from(select.options).forEach(function(option) {
        if (option.value === 'NGN') { option.disabled = !nigerian; option.hidden = !nigerian; }
      });
      select.value = currency;
      update();
    }
  } };
  var region;
  try { region = zones[Intl.DateTimeFormat().resolvedOptions().timeZone] || new Intl.Locale(navigator.language).region; } catch (_) {}
  select.value = countries[region] || 'USD';
  nigerian = select.value === 'NGN';
  window.PricingCurrency.setCountry(region || 'US');
})();
