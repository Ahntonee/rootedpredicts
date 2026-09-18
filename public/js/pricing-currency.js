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
  var manual = false, version = 0;
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
  async function quote(currency) {
    var response = await fetch('/api/subscriptions/pricing?currency=' + encodeURIComponent(currency) + '&duration=' + duration());
    var json = await response.json();
    if (!response.ok || !json.success) throw new Error('Prices unavailable');
    return json.data;
  }
  function render(data) {
    select.value = data.currency;
    var biweekly = duration() === 'biweekly';
    if (document.querySelectorAll) {
      document.querySelectorAll('.pricing-card .pricing-period').forEach(function(el) { el.textContent = biweekly ? 'every 2 weeks' : 'per month'; });
      document.querySelectorAll('.pricing-card .trial-note').forEach(function(el) { el.textContent = biweekly ? '14 days of access.' : '30 days of access.'; });
    }
    Object.keys(data.plans).forEach(function (plan) {
      var price = data.plans[plan];
      document.getElementById('sub-' + plan + '-price').textContent = money(price.amount, data.currency);
    });
  }
  async function update() {
    var request = ++version;
    try {
      var data = await quote(select.value);
      if (request === version) render(data);
    } catch (_) {
      if (request === version) {
        var naira = select.value === 'NGN';
        render({ currency: naira ? 'NGN' : 'USD', plans: { standard: { amount: (naira ? 15000 : 30) * (duration() === 'biweekly' ? 0.5 : 1) }, deluxe: { amount: (naira ? 25000 : 45) * (duration() === 'biweekly' ? 0.5 : 1) } } });
      }
    }
  }
  var durationSelect = document.getElementById('pricing-duration');
  if (durationSelect) durationSelect.addEventListener('change', update);
  select.addEventListener('change', function () {
    manual = true;
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
    if (!manual && currency && select.value !== currency) { select.value = currency; update(); }
  } };
  var region;
  try { region = zones[Intl.DateTimeFormat().resolvedOptions().timeZone] || new Intl.Locale(navigator.language).region; } catch (_) {}
  select.value = countries[region] || 'USD';
  try {
    var saved = localStorage.getItem('pricing_currency');
    if (choices.includes(saved)) { select.value = saved; }
  } catch (_) {}
  update();
})();
