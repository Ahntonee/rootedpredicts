(function () {
  'use strict';
  var countries = { NG:'NGN', US:'USD', GB:'GBP', GH:'GHS', KE:'KES', ZA:'ZAR', IN:'INR', AU:'AUD', CA:'CAD', NZ:'NZD', JP:'JPY', CN:'CNY', PH:'PHP', ID:'IDR', PK:'PKR', BD:'BDT', AE:'AED', SA:'SAR', EG:'EGP', UG:'UGX', TZ:'TZS', RW:'RWF', ZM:'ZMW', BW:'BWP', MA:'MAD', TN:'TND', DZ:'DZD', CM:'XAF', SN:'XOF', CI:'XOF', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', PT:'EUR', NL:'EUR', BE:'EUR', IE:'EUR', AT:'EUR', FI:'EUR', GR:'EUR', CY:'EUR', MT:'EUR', EE:'EUR', LV:'EUR', LT:'EUR', SK:'EUR', SI:'EUR', HR:'EUR', LU:'EUR', CH:'CHF', SE:'SEK', NO:'NOK', DK:'DKK', PL:'PLN', CZ:'CZK', HU:'HUF', RO:'RON', TR:'TRY', BR:'BRL', MX:'MXN', AR:'ARS', CL:'CLP', CO:'COP', SG:'SGD', MY:'MYR', TH:'THB', VN:'VND', KR:'KRW', HK:'HKD', TW:'TWD', IL:'ILS', QA:'QAR', KW:'KWD', BH:'BHD', OM:'OMR' };
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
        vipPrice.textContent = 'From ' + money(data.plans.monthly.amount, data.currency) + '/month';
        var periods = document.createElement('p');
        periods.style.cssText = 'color:#fff;font-size:0.8rem;margin-top:10px;';
        periods.textContent = 'Quarterly: ' + money(data.plans.quarterly.amount, data.currency) + ' / Annual: ' + money(data.plans.annual.amount, data.currency);
        vipPrice.after(periods);
      } catch (_) { vipPrice.textContent = 'From NGN 15,000/month'; }
    });
    return;
  }
  var manual = false, version = 0, usd = null;
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
    return new Intl.NumberFormat(navigator.languages, { style:'currency', currency:currency, currencyDisplay:'code' }).format(amount);
  }
  async function quote(currency) {
    var response = await fetch('/api/subscriptions/pricing?currency=' + encodeURIComponent(currency));
    var json = await response.json();
    if (!response.ok || !json.success) throw new Error('Prices unavailable');
    return json.data;
  }
  function render(data) {
    select.value = data.currency;
    Object.keys(data.plans).forEach(function (plan) {
      var price = data.plans[plan];
      document.getElementById('sub-' + plan + '-price').textContent = money(price.amount, data.currency);
      document.getElementById('sub-' + plan + '-equivalent').textContent = data.currency !== 'NGN'
        ? 'Base price: ' + money(price.ngn, 'NGN')
        : usd && usd.currency === 'USD' ? 'Approx. ' + money(usd.plans[plan].amount, 'USD') : '';
    });
    document.getElementById('currency-note').textContent = data.notice || (data.currency === 'NGN'
      ? 'Exact naira prices. Dollar equivalents are estimates; bank fees may differ.'
      : 'Estimated conversion. Bank transfers are paid in NGN; your bank rate and fees may differ.') +
      (data.updated_at ? ' Rates dated ' + new Date(data.updated_at).toLocaleDateString() + '.' : '');
  }
  async function update() {
    var request = ++version;
    try {
      var data = await quote(select.value);
      if (request === version) render(data);
    } catch (_) {
      if (request === version) {
        render({ currency:'NGN', plans:{ monthly:{ngn:15000,amount:15000}, quarterly:{ngn:45000,amount:45000}, annual:{ngn:150000,amount:150000} }, notice:'Conversion unavailable. Showing the exact naira price.' });
      }
    }
  }
  select.addEventListener('change', function () {
    manual = true;
    try { localStorage.setItem('pricing_currency', select.value); } catch (_) {}
    update();
  });
  window.PricingCurrency = { setCountry: function (country) {
    var currency = countries[String(country || '').toUpperCase()];
    if (!manual && currency && select.value !== currency) { select.value = currency; update(); }
  } };
  var region;
  try { region = zones[Intl.DateTimeFormat().resolvedOptions().timeZone] || new Intl.Locale(navigator.language).region; } catch (_) {}
  select.value = countries[region] || 'USD';
  try {
    var saved = localStorage.getItem('pricing_currency');
    if (choices.includes(saved)) { select.value = saved; manual = true; }
  } catch (_) {}
  quote('USD').then(function (data) { usd = data; if (select.value === 'NGN') update(); }).catch(function () {});
  update();
})();
