(function () {
  var LOG_PREFIX = '[VolumePricing]';
  var QUANTITY_SELECTOR = 'input[name="quantity"], .quantity__input, [data-quantity-input]';

  // Product page price display — tuned for the main product price block.
  var PRODUCT_PRICE_SELECTOR = '.price-item--regular, [data-product-price], [data-volume-pricing-unit-price]';

  // Cart line price display — deliberately a much wider net than the product
  // page selector, since cart/cart-drawer price markup varies far more
  // between themes (Dawn alone uses different classes on /cart vs. the
  // drawer). Reusing PRODUCT_PRICE_SELECTOR here was the actual bug: it
  // simply never matched anything inside a cart row, so renderPrice() was
  // never called there at all — not a metafield or Liquid problem.
  var CART_PRICE_SELECTOR =
    '.cart-item__price, .cart-item__price-wrapper .price, .cart-item__totals .price, ' +
    '[data-cart-line-price], [data-cart-item-price], .cart-item-price, .line-item__price, ' +
    '.cart__price, .price--end, .price--final, [data-volume-pricing-unit-price], .price';

  var CART_LINE_SELECTOR =
    '.cart-item, [data-cart-item], .cart__row, .drawer__cart-item, .cart-drawer-item, ' +
    'cart-drawer-item, cart-item, [data-cart-items] > *';

  // Dawn-specific precise targets (confirmed against actual Dawn cart markup):
  // the unit price lives among the variant-option <div>s in cart-item__details
  // (distinguished from option pairs by containing a price and no <dt>/<dl>),
  // and the line *total* is a separate element entirely under
  // cart-item__totals — conflating the two was the previous bug.
  var UNIT_PRICE_CANDIDATE_SELECTOR = '.cart-item__details > .product-option';
  var LINE_TOTAL_SELECTOR =
    '.cart-item__totals .cart-item__price-wrapper .price, .cart-item__totals .price--end';
  // .totals__total-value is Dawn's actual class (confirmed against real
  // markup: <div class="totals"><h2 class="totals__total">Estimated
  // total</h2><p class="totals__total-value">$1,670.00 AUD</p></div>) — the
  // previous .totals__subtotal-value guess didn't exist in Dawn at all,
  // which is why nothing ever updated here.
  var SUBTOTAL_SELECTOR =
    '.totals__total-value, .totals__subtotal-value, [data-cart-subtotal], .cart__subtotal';

  // Requires a 2-decimal price format (e.g. "$3.34", "3,34 €") — deliberately
  // stricter than "any text with a digit in it" so this can't mistake a bare
  // quantity count (e.g. a leaf "2" or "500" element) for a price and corrupt it.
  var MONEY_TEXT_PATTERN = /^[^\d\s]{0,3}\s?\d[\d,.]*[.,]\d{2}\s?[^\d\s]{0,3}$/;
  var PRICE_CONTAINS_PATTERN = /[^\d\s]{0,3}\s?[\d,]+\.\d{2}/;

  var ORIGINAL_HTML_ATTR = 'data-volume-pricing-original-html';
  var SAVINGS_ROW_CLASS = 'volume-pricing-savings-row';

  function log(message, detail) {
    if (window.console && console.debug) {
      console.debug(LOG_PREFIX + ' ' + message, detail === undefined ? '' : detail);
    }
  }

  // console.debug is hidden by default in Chrome/Firefox DevTools unless the
  // "Verbose" level is explicitly enabled, which makes correctly-running code
  // look silent. Anything that helps diagnose "why didn't a request fire"
  // uses this (console.info/warn/error) instead, visible at default levels.
  function logVisible(level, message, detail) {
    if (!window.console) return;
    var fn = console[level] || console.log;
    fn.call(console, LOG_PREFIX + ' ' + message, detail === undefined ? '' : detail);
  }

  // Last-resort fallback when none of the known CART_PRICE_SELECTOR patterns
  // match anything in a row: find leaf elements (no child elements, so we
  // don't grab a whole wrapper div) whose own text looks like a price.
  function findMoneyElements(scope) {
    var candidates = scope.querySelectorAll('*');
    var matches = [];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.children.length > 0) continue;
      var text = el.textContent.trim();
      if (text && MONEY_TEXT_PATTERN.test(text)) {
        matches.push(el);
      }
    }
    return matches;
  }

  function readJsonById(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (err) {
      return null;
    }
  }

  // "Sort tiers in descending order... find the qualifying tier... matched
  // tier price remains active from its minQuantity until the next threshold."
  // No thresholds are ever hardcoded — everything comes from the metafield.
  function sortTiersDescending(tiers) {
    return (Array.isArray(tiers) ? tiers : []).slice().sort(function (a, b) {
      return Number(b.minQuantity) - Number(a.minQuantity);
    });
  }

  function findQualifyingTier(tiers, currentQty) {
    for (var i = 0; i < tiers.length; i++) {
      if (currentQty >= Number(tiers[i].minQuantity)) {
        return tiers[i];
      }
    }
    return null;
  }

  // Fallback formatter only used when there's no original text to pattern
  // off of. Deliberately simple (no thousands separators) — formatMoneyLike
  // below is what actually reproduces the theme's real formatting.
  function formatPrice(amount, symbol) {
    var rounded = Math.round((Number(amount) || 0) * 100) / 100;
    return (symbol || '$') + rounded.toFixed(2);
  }

  // Reverses formatted money text (e.g. "$1,670.00 AUD") back to a number.
  // Strips anything that isn't a digit/comma/dot — a trailing ISO currency
  // code like "AUD" is just letters, so it's dropped along with the symbol.
  function parseMoneyToNumber(text) {
    if (!text) return null;
    var cleaned = String(text).replace(/[^0-9.,]/g, '').replace(/,/g, '');
    var value = parseFloat(cleaned);
    return isNaN(value) ? null : value;
  }

  // Reformats `amount` using the exact surrounding text of `templateText` —
  // e.g. templateText "$1,670.00 AUD" + amount 1605 -> "$1,605.00 AUD".
  // This is what makes the rewritten price match the theme's own formatting
  // (thousands separator, trailing currency code, spacing) instead of a
  // generic "$" + two decimals that would silently drop all of that.
  function formatMoneyLike(amount, templateText, fallbackSymbol) {
    var rounded = Math.round((Number(amount) || 0) * 100) / 100;
    var numberMatch = templateText && templateText.match(/\d[\d.,]*\d|\d/);
    if (!numberMatch) {
      return formatPrice(amount, fallbackSymbol);
    }
    var formattedNumber = rounded.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (
      templateText.slice(0, numberMatch.index) +
      formattedNumber +
      templateText.slice(numberMatch.index + numberMatch[0].length)
    );
  }

  // Caches a container's pre-existing markup once (so toggling back to "no
  // discount" always restores the true original, never an already-rewritten
  // one), and returns {original, template} — template is that markup's text
  // content, used by formatMoneyLike to reproduce the theme's own formatting.
  function cacheOriginal(container, fallbackAmount, currencySymbol) {
    if (!container.hasAttribute(ORIGINAL_HTML_ATTR)) {
      container.setAttribute(ORIGINAL_HTML_ATTR, container.innerHTML);
    }
    var original = container.getAttribute(ORIGINAL_HTML_ATTR);
    var scratch = document.createElement('div');
    scratch.innerHTML = original;
    var template = scratch.textContent || formatPrice(fallbackAmount, currencySymbol);
    return { original: original, template: template };
  }

  // Inline side-by-side strikethrough + discounted price — used for unit
  // prices and line totals, where there's room on one line.
  function renderAmount(container, originalAmount, discountedAmount, qualifies, currencySymbol) {
    var cached = cacheOriginal(container, originalAmount, currencySymbol);

    var nextHtml = qualifies
      ? '<span class="original-price-strikethrough">' +
        formatMoneyLike(originalAmount, cached.template, currencySymbol) +
        '</span><span class="tiered-discounted-price">' +
        formatMoneyLike(discountedAmount, cached.template, currencySymbol) +
        '</span>'
      : cached.original;

    // Skip no-op writes — important so the cart MutationObserver below
    // doesn't react to its own updates and loop.
    if (container.innerHTML !== nextHtml) {
      container.innerHTML = nextHtml;
    }
  }

  // Vertically stacked discounted-on-top / strikethrough-below — used for
  // the cart subtotal, which sits as one flex item in a label/value row
  // (e.g. Dawn's .totals): side-by-side spans there would widen that row
  // enough to wrap the row's own label text.
  function renderStackedAmount(container, originalAmount, discountedAmount, qualifies, currencySymbol) {
    var cached = cacheOriginal(container, originalAmount, currencySymbol);

    var nextHtml = qualifies
      ? '<span class="volume-pricing-price-stack">' +
        '<span class="tiered-discounted-price">' +
        formatMoneyLike(discountedAmount, cached.template, currencySymbol) +
        '</span><span class="original-price-strikethrough">' +
        formatMoneyLike(originalAmount, cached.template, currencySymbol) +
        '</span></span>'
      : cached.original;

    if (container.innerHTML !== nextHtml) {
      container.innerHTML = nextHtml;
    }
  }

  function renderPrice(container, basePrice, tier, currencySymbol) {
    var qualifies = Boolean(tier) && Number(tier.price) < Number(basePrice);
    renderAmount(container, basePrice, qualifies ? tier.price : basePrice, qualifies, currencySymbol);
  }

  // Dawn's cart-item__details contains both the unit price and variant-option
  // pairs (each wrapped in its own .product-option, with the pair rendered as
  // a <dl><div class="product-option"><dt>Color:</dt>...</div></dl>). Only
  // the unit price is a *direct* .product-option child with no nested
  // <dt>/<dl>, and its own text looks like a price.
  function findDawnUnitPriceElement(row) {
    var candidates = row.querySelectorAll(UNIT_PRICE_CANDIDATE_SELECTOR);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.querySelector('dt, dl')) continue;
      if (PRICE_CONTAINS_PATTERN.test(el.textContent || '')) {
        return el;
      }
    }
    return null;
  }

  function highlightTierRows(scope, tier) {
    var rows = scope.querySelectorAll('[data-min-qty]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var isActive = Boolean(tier) && String(row.getAttribute('data-min-qty')) === String(tier.minQuantity);
      row.classList.toggle('volume-pricing-table__row--active', isActive);
    }
  }

  // ---------------------------------------------------------------------
  // Product Details Page
  // ---------------------------------------------------------------------
  function initProductPage() {
    var data = readJsonById('volume-pricing-product-data');
    if (!data || !Array.isArray(data.tiers) || data.tiers.length === 0) return;

    var tiers = sortTiersDescending(data.tiers);
    var basePrice = Number(data.basePrice) || 0;
    var currencySymbol = data.currencySymbol;
    var tableBlock = document.querySelector('[data-volume-pricing-block]');

    function update(rawQuantity) {
      var quantity = Math.max(1, parseInt(rawQuantity, 10) || 1);
      var tier = findQualifyingTier(tiers, quantity);

      if (tableBlock) {
        highlightTierRows(tableBlock, tier);
      }

      var priceEls = document.querySelectorAll(PRODUCT_PRICE_SELECTOR);
      log('product page: quantity=' + quantity + ', matched tier=', tier);
      log('product page: price target(s) found=', priceEls.length);
      for (var i = 0; i < priceEls.length; i++) {
        renderPrice(priceEls[i], basePrice, tier, currencySymbol);
      }
    }

    var quantityInput = document.querySelector(QUANTITY_SELECTOR);
    update(quantityInput ? quantityInput.value : 1);

    document.addEventListener('input', function (event) {
      if (event.target && event.target.matches && event.target.matches(QUANTITY_SELECTOR)) {
        update(event.target.value);
      }
    });
    document.addEventListener('change', function (event) {
      if (event.target && event.target.matches && event.target.matches(QUANTITY_SELECTOR)) {
        update(event.target.value);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Cart page & cart drawer
  // ---------------------------------------------------------------------
  // There's no universal Shopify theme convention for how a cart line
  // identifies its product/variant in the DOM, so this matches best-effort
  // against common patterns (a data-* key attribute, or a product link) —
  // it may need small selector tweaks for a specific theme.
  function findCartItemForRow(row, byKey, byProductId) {
    var key =
      row.getAttribute('data-cart-item-key') ||
      row.getAttribute('data-line-item-key') ||
      row.getAttribute('data-key');
    if (key && byKey[key]) return byKey[key];

    var explicitProductId = row.getAttribute('data-product-id');
    if (explicitProductId && byProductId[explicitProductId]) {
      return byProductId[explicitProductId];
    }

    var productLink = row.querySelector('a[href*="/products/"]');
    if (productLink) {
      for (var id in byProductId) {
        if (Object.prototype.hasOwnProperty.call(byProductId, id)) {
          var handle = byProductId[id].productHandle;
          if (handle && productLink.getAttribute('href').indexOf('/products/' + handle) !== -1) {
            return byProductId[id];
          }
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Dynamic single-use discount code lifecycle (standard-plan fallback for
  // stores that can't register the tiered-discount-function as a live
  // automatic discount). On every cart mutation the app backend atomically
  // invalidates whatever code was issued for this cart and, if the fresh
  // cart still qualifies, issues and returns a brand-new one-time code,
  // which is then applied via the Cart AJAX API's native `discount` field —
  // no checkout/Plus features and no page reload required.
  // ---------------------------------------------------------------------
  var DISCOUNT_SYNC_DEBOUNCE_MS = 700;
  // A pure debounce (clearTimeout + reset on every call) never fires at all
  // if something keeps calling it more often than the debounce window — on
  // a real storefront, the MutationObserver this is wired to watches the
  // entire document.body, so any unrelated widget that mutates the DOM more
  // often than every 700ms (a chat widget, a countdown timer, lazy-loaded
  // reviews) perpetually resets the timer before it ever elapses. This caps
  // the total wait since the FIRST call in a burst, guaranteeing the sync
  // still fires even under continuous, unrelated DOM churn.
  var DISCOUNT_SYNC_MAX_WAIT_MS = 2000;
  var discountSyncTimer = null;
  var discountSyncBurstStartedAt = null;
  var discountSyncSeq = 0;
  var activeDiscountCode = null;
  // Set only once a sync's response has actually been processed (not when
  // merely scheduled/dispatched) — lets an identical cart state short-
  // circuit before ever touching the network, which is what keeps harmless
  // re-syncs (unrelated DOM churn, a duplicate debounce firing) from
  // costing a round trip, let alone a Shopify mutation.
  var lastSyncedLinesSignature = null;

  // Order-independent: DOM row order (what builds `lines`) can vary between
  // passes even when the cart itself hasn't changed, so this sorts by
  // productId first — otherwise an identical cart could produce two
  // different signatures and defeat the dedup check entirely.
  function computeLinesSignature(lines) {
    var sorted = lines.slice().sort(function (a, b) {
      return String(a.productId).localeCompare(String(b.productId));
    });
    return JSON.stringify(sorted);
  }

  // Set by initCart() to its scheduleUpdateAllRows (see below) — lets the
  // module-level AJAX interceptor trigger a refresh without needing access
  // to initCart's closure.
  var cartRefreshHandler = null;

  function cartUpdateRequest(discountValue, reasonForLog) {
    var url = '/cart/update.js';
    var payload = { discount: discountValue };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Volume-Pricing-Internal': '1' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) {
        logVisible('error', reasonForLog + ' failed: ' + url + ' -> HTTP ' + res.status);
      }
      return res;
    });
  }

  function applyDiscountCode(code) {
    return cartUpdateRequest(code, 'applying discount code "' + code + '"');
  }

  function clearDiscountCode() {
    return cartUpdateRequest('', 'clearing discount code');
  }

  function syncDynamicDiscount(cartData, lines) {
    if (!cartData.proxyPath || !cartData.cartToken) {
      logVisible('warn', 'skipping discount sync — missing proxyPath or cartToken.');
      return;
    }
    // Nothing active and nothing qualifying — skip the round trip entirely.
    if (lines.length === 0 && !activeDiscountCode) return;

    var signature = computeLinesSignature(lines);
    if (signature === lastSyncedLinesSignature) return;

    var seq = ++discountSyncSeq;
    var requestBody = { cartToken: cartData.cartToken, lines: lines };

    fetch(cartData.proxyPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
      .then(function (res) {
        if (!res.ok) {
          logVisible('error', 'cart sync request to ' + cartData.proxyPath + ' returned HTTP ' + res.status);
        }
        return res.json();
      })
      .then(function (result) {
        // A newer cart mutation already superseded this in-flight request.
        if (seq !== discountSyncSeq) return;

        // Recorded only once the response is actually processed, and only
        // for a response that wasn't itself superseded above — this is what
        // makes the NEXT identical-cart sync short-circuit before dispatch.
        lastSyncedLinesSignature = signature;

        if (result && result.qualifies && result.code) {
          if (result.code === activeDiscountCode) {
            // Same code already applied (e.g. the backend's own reuse
            // guard returned the existing one unchanged) — skip the
            // redundant /cart/update.js round trip entirely.
            return;
          }
          activeDiscountCode = result.code;
          return applyDiscountCode(result.code);
        }

        if (activeDiscountCode) {
          activeDiscountCode = null;
          return clearDiscountCode();
        }
      })
      .catch(function (err) {
        logVisible('error', 'cart sync request to ' + cartData.proxyPath + ' threw', err && err.message);
      });
  }

  function scheduleDiscountSync(cartData, lines) {
    var now = Date.now();
    if (discountSyncBurstStartedAt === null) {
      discountSyncBurstStartedAt = now;
    }
    clearTimeout(discountSyncTimer);

    var elapsedSinceBurstStart = now - discountSyncBurstStartedAt;
    var remainingBeforeMaxWait = DISCOUNT_SYNC_MAX_WAIT_MS - elapsedSinceBurstStart;
    var delay = Math.max(0, Math.min(DISCOUNT_SYNC_DEBOUNCE_MS, remainingBeforeMaxWait));

    if (remainingBeforeMaxWait <= DISCOUNT_SYNC_DEBOUNCE_MS) {
      logVisible(
        'warn',
        'discount sync: max-wait ceiling reached (continuous DOM mutations kept resetting the debounce) ' +
          '— firing now instead of waiting for quiet.'
      );
    }

    discountSyncTimer = setTimeout(function () {
      discountSyncBurstStartedAt = null;
      syncDynamicDiscount(cartData, lines);
    }, delay);
  }

  // ---------------------------------------------------------------------
  // Custom branding selector (blocks/branding_selector.liquid)
  // ---------------------------------------------------------------------
  // The selected method's run-charge variant (hidden "Custom Branding"
  // product) and its linked setup-fee variant (hidden "Setup Charge"
  // product) ride along in the SAME /cart/add request as the product itself
  // — one atomic add, so the cart can never end up with branded items but no
  // branding charges.
  var PRODUCT_FORM_SELECTOR = 'form[action*="/cart/add"]';
  var brandingState = null;

  // The product form for THIS product (not a quick-add form elsewhere on the
  // page). form.elements includes inputs attached via a `form="…"`
  // attribute — Dawn's quantity input lives outside the <form> that way.
  function readProductQuantity() {
    var forms = document.querySelectorAll(PRODUCT_FORM_SELECTOR);
    for (var i = 0; i < forms.length; i++) {
      var idField = forms[i].elements.namedItem('id');
      if (!idField || !brandingState || brandingState.variantIds.indexOf(Number(idField.value)) === -1) continue;
      var qtyField = forms[i].elements.namedItem('quantity');
      return Math.max(1, parseInt(qtyField && qtyField.value, 10) || 1);
    }
    return 1;
  }

  function fillTemplate(template, values) {
    return String(template || '').replace(/__([a-z])__/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    });
  }

  function initBrandingSelector() {
    var root = document.querySelector('[data-branding-selector]');
    brandingState = null;
    if (!root) return;

    var select = root.querySelector('#branding-method-select');
    var qtyWrapper = root.querySelector('#branding-qty-wrapper');
    var multiplierLabel = root.querySelector('#branding-multiplier-label');
    var multiplierInput = root.querySelector('#branding-multiplier-input');
    var summary = root.querySelector('#branding-breakdown-summary');
    var errorEl = root.querySelector('[data-branding-error]');
    if (!select || !qtyWrapper || !multiplierInput || !summary) {
      logVisible('warn', 'branding selector markup is incomplete — branding charges are disabled.', root);
      return;
    }

    var data = root.dataset;
    var moneyTemplate = data.moneyTemplate;
    var variantIds = String(data.variantIds || '')
      .split(',')
      .map(Number)
      .filter(Boolean);

    function money(amount) {
      return formatMoneyLike(amount, moneyTemplate, data.currencySymbol);
    }

    function multiplierLabelFor(feeType) {
      return feeType === 'PER_POSITION' ? data.positionLabel : data.colourLabel;
    }

    // The chosen "Custom Branding" method plus the "Setup Charge" variant the
    // metafield links it to — re-read on every change, so the setup charge
    // always follows the selected method and multiplier.
    function currentSelection() {
      var option = select.options[select.selectedIndex];
      if (!option || !option.value) return null;
      var brandingVariantId = Number(option.dataset.brandingVariant);
      var setupVariantId = Number(option.dataset.setupVariant);
      if (!brandingVariantId || !setupVariantId) return null;
      return {
        name: option.dataset.name || option.textContent.trim(),
        feeType: option.dataset.feeType,
        brandingVariantId: brandingVariantId,
        unitRunCharge: Number(option.dataset.unitRunCharge) || 0,
        setupVariantId: setupVariantId,
        setupCost: Number(option.dataset.setupCost) || 0,
        multiplier: Math.max(1, parseInt(multiplierInput.value, 10) || 1),
      };
    }

    function render() {
      var selection = currentSelection();
      qtyWrapper.hidden = !selection;
      summary.hidden = !selection;
      if (!selection) return;

      if (multiplierLabel) multiplierLabel.textContent = multiplierLabelFor(selection.feeType);

      var productQty = readProductQuantity();
      var totalSetup = selection.multiplier * selection.setupCost;
      var totalRun = productQty * selection.multiplier * selection.unitRunCharge;
      var lines = {
        '[data-branding-setup-line]': fillTemplate(data.setupTemplate, {
          m: selection.multiplier,
          c: money(selection.setupCost),
          t: money(totalSetup),
        }),
        '[data-branding-run-line]': fillTemplate(data.runTemplate, {
          q: productQty,
          m: selection.multiplier,
          c: money(selection.unitRunCharge),
          t: money(totalRun),
        }),
        '[data-branding-total-line]': fillTemplate(data.totalTemplate, { t: money(totalSetup + totalRun) }),
      };
      for (var selector in lines) {
        var el = summary.querySelector(selector);
        if (el && el.textContent !== lines[selector]) el.textContent = lines[selector];
      }
    }

    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }

    select.addEventListener('change', function () {
      showError('');
      render();
    });
    multiplierInput.addEventListener('input', render);
    multiplierInput.addEventListener('change', function () {
      multiplierInput.value = Math.max(1, parseInt(multiplierInput.value, 10) || 1);
      render();
    });

    brandingState = {
      variantIds: variantIds,
      productTitle: data.productTitle,
      propertyBranding: data.propertyBranding || 'Branding',
      propertyFor: data.propertyFor || 'For',
      addError: data.addError,
      currentSelection: currentSelection,
      multiplierLabelFor: multiplierLabelFor,
      render: render,
      showError: showError,
    };

    render();
    root.setAttribute('data-branding-ready', '');
  }

  // Normalizes a /cart/add body (FormData, URLSearchParams, urlencoded or
  // JSON string) to { items, extras, singleItem }, or null when it's a shape
  // we can't safely rewrite (form-encoded items[], file uploads, unknown).
  function parseCartAddBody(body) {
    if (typeof body === 'string') {
      var trimmed = body.trim();
      if (trimmed.charAt(0) === '{') {
        var json;
        try {
          json = JSON.parse(trimmed);
        } catch (err) {
          return null;
        }
        var jsonExtras = {};
        if (json.sections !== undefined) jsonExtras.sections = json.sections;
        if (json.sections_url !== undefined) jsonExtras.sections_url = json.sections_url;
        if (Array.isArray(json.items)) {
          return { items: json.items.slice(), extras: jsonExtras, singleItem: false };
        }
        if (!json.id) return null;
        var jsonItem = { id: Number(json.id), quantity: Number(json.quantity) || 1 };
        if (json.properties) jsonItem.properties = json.properties;
        if (json.selling_plan) jsonItem.selling_plan = json.selling_plan;
        return { items: [jsonItem], extras: jsonExtras, singleItem: true };
      }
      body = new URLSearchParams(trimmed);
    }

    var isFormLike =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);
    if (!isFormLike) return null;

    var item = { quantity: 1 };
    var properties = {};
    var hasProperties = false;
    var extras = {};
    var entries = Array.from(body.entries());
    for (var i = 0; i < entries.length; i++) {
      var key = entries[i][0];
      var value = entries[i][1];
      if (typeof value !== 'string') return null;
      if (key.indexOf('items[') === 0) return null;
      var propertyMatch = key.match(/^properties\[(.+)\]$/);
      if (propertyMatch) {
        properties[propertyMatch[1]] = value;
        hasProperties = true;
      } else if (key === 'id') {
        item.id = Number(value);
      } else if (key === 'quantity') {
        item.quantity = Math.max(1, parseInt(value, 10) || 1);
      } else if (key === 'selling_plan' && value) {
        item.selling_plan = value;
      } else if (key === 'sections' || key === 'sections_url') {
        extras[key] = value;
      }
    }
    if (!item.id) return null;
    if (hasProperties) item.properties = properties;
    return { items: [item], extras: extras, singleItem: true };
  }

  // Appends the branding lines to a parsed add request, or returns null when
  // no branding is selected / the request isn't for this page's product.
  function buildBrandedItems(parsed) {
    if (!brandingState || !parsed) return null;
    var selection = brandingState.currentSelection();
    if (!selection) return null;

    var mainItem = null;
    for (var i = 0; i < parsed.items.length; i++) {
      if (brandingState.variantIds.indexOf(Number(parsed.items[i].id)) !== -1) {
        mainItem = parsed.items[i];
        break;
      }
    }
    if (!mainItem) return null;

    var multiplierKey = String(brandingState.multiplierLabelFor(selection.feeType) || '').replace(/:\s*$/, '');
    var brandingProps = {};
    brandingProps[brandingState.propertyBranding] = selection.name;
    brandingProps[multiplierKey] = String(selection.multiplier);

    mainItem.properties = Object.assign({}, mainItem.properties || {}, brandingProps);

    var chargeProps = Object.assign({}, brandingProps);
    chargeProps[brandingState.propertyFor] = brandingState.productTitle;
    // Hidden (underscore) property: ties the charge lines to the branded
    // variant, and keeps two branded products' charges on separate lines.
    chargeProps._branding_parent_variant = String(mainItem.id);

    var productQty = Math.max(1, Number(mainItem.quantity) || 1);
    // Order: main product, "Custom Branding" run charge (product qty ×
    // multiplier units), then its linked "Setup Charge" (multiplier units).
    var items = parsed.items.concat([
      { id: selection.brandingVariantId, quantity: productQty * selection.multiplier, properties: chargeProps },
      { id: selection.setupVariantId, quantity: selection.multiplier, properties: chargeProps },
    ]);
    return { items: items, mainVariantId: Number(mainItem.id) };
  }

  // A multi-item /cart/add returns { items: [...] }, but a theme that posted
  // a single `id` expects the single line-item shape back (Dawn reads
  // response.key / response.sections). Re-shape it to the branded product's
  // own line so the theme's success handling works unchanged.
  function adaptBrandedResponse(response, parsed, mainVariantId) {
    if (!parsed.singleItem || !response.ok) return response;
    return response
      .clone()
      .json()
      .then(function (json) {
        var lines = (json && json.items) || [];
        var mainLine = null;
        for (var i = 0; i < lines.length; i++) {
          if (Number(lines[i].variant_id) === mainVariantId) {
            mainLine = lines[i];
            break;
          }
        }
        if (!mainLine) return response;
        var shaped = Object.assign({}, mainLine);
        if (json.sections !== undefined) shaped.sections = json.sections;
        return new Response(JSON.stringify(shaped), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .catch(function () {
        return response;
      });
  }

  function bundleBrandingIntoAddRequest(init) {
    if (!init || !init.body) return null;
    var parsed = parseCartAddBody(init.body);
    var branded = buildBrandedItems(parsed);
    if (!branded) return null;

    var headers = new Headers(init.headers || {});
    headers.set('Content-Type', 'application/json');
    var payload = Object.assign({ items: branded.items }, parsed.extras);
    logVisible('info', 'bundling branding charges into /cart/add', payload.items);

    return {
      init: Object.assign({}, init, { headers: headers, body: JSON.stringify(payload) }),
      adaptResponse: function (response) {
        return adaptBrandedResponse(response, parsed, branded.mainVariantId);
      },
    };
  }

  // Themes without AJAX add-to-cart submit the product form natively. If no
  // theme script claimed the submit (defaultPrevented), do the bundled add
  // ourselves and continue to the cart page as the native submit would have.
  function installBrandingFormSubmitHandler() {
    if (window.__volumePricingBrandingSubmitWrapped) return;
    window.__volumePricingBrandingSubmitWrapped = true;

    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (event.defaultPrevented || !brandingState || !form || !form.matches) return;
      if (!form.matches(PRODUCT_FORM_SELECTOR)) return;

      var parsed = parseCartAddBody(new FormData(form));
      var branded = buildBrandedItems(parsed);
      if (!branded) return;

      event.preventDefault();
      brandingState.showError('');
      var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
      fetch(root + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Volume-Pricing-Internal': '1' },
        body: JSON.stringify({ items: branded.items }),
      })
        .then(function (res) {
          if (res.ok) {
            window.location.href = root + 'cart';
            return;
          }
          return res.json().then(function (err) {
            brandingState.showError((err && (err.description || err.message)) || brandingState.addError);
          });
        })
        .catch(function () {
          if (brandingState) brandingState.showError(brandingState.addError);
        });
    });

    // The run charge scales with the product quantity, so keep the
    // breakdown live as the shopper changes it.
    function onQuantityEvent(event) {
      if (brandingState && event.target && event.target.matches && event.target.matches(QUANTITY_SELECTOR)) {
        brandingState.render();
      }
    }
    document.addEventListener('input', onQuantityEvent);
    document.addEventListener('change', onQuantityEvent);
    // Quantity steppers (+/-) often set the value without firing input/change.
    document.addEventListener('click', function () {
      if (brandingState) setTimeout(brandingState.render, 0);
    });
  }

  // Direct, theme-agnostic trigger for cart mutations: Dawn (and most themes)
  // call these endpoints via fetch for add/change/clear regardless of
  // whether a given UI control (e.g. a quantity stepper button, vs. typing
  // in the input) happens to dispatch a native `input`/`change` DOM event.
  // Relying only on DOM events + MutationObserver is inferential; this is
  // direct. Our own /cart/update.js calls (apply/clear the discount code)
  // are tagged with X-Volume-Pricing-Internal so they don't re-trigger this
  // and loop.
  function installCartAjaxInterceptor() {
    if (window.__volumePricingFetchWrapped) return;
    window.__volumePricingFetchWrapped = true;

    var originalFetch = window.fetch;
    window.fetch = function (resource, init) {
      var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
      var isInternal = init && init.headers && init.headers['X-Volume-Pricing-Internal'];
      var bundled = !isInternal && /\/cart\/add(\.js)?(\?|$)/.test(url) ? bundleBrandingIntoAddRequest(init) : null;
      var promise = bundled
        ? originalFetch.call(this, resource, bundled.init).then(bundled.adaptResponse)
        : originalFetch.apply(this, arguments);
      if (!isInternal && /\/cart\/(add|change|clear)(\.js)?(\?|$)/.test(url)) {
        promise
          .then(function () {
            // This .then() fires the instant the raw Response resolves —
            // before the theme's OWN .then() chain has read the body and
            // patched the DOM (that's a further async step, sometimes a
            // second fetch for re-rendered section HTML). Calling
            // cartRefreshHandler() synchronously here would run updateAllRows
            // against the pre-mutation DOM. The MutationObserver remains the
            // authoritative trigger once that real patch lands; this is only
            // a backstop for mutations that don't touch the DOM tree at all
            // (so the observer wouldn't fire), hence the deliberate delay
            // rather than firing immediately.
            setTimeout(function () {
              if (cartRefreshHandler) cartRefreshHandler();
            }, 300);
          })
          .catch(function () {
            // Request itself failed — nothing to refresh.
          });
      }
      return promise;
    };
  }

  function initCart() {
    var cartData = readJsonById('volume-pricing-cart-data');
    if (!cartData) {
      logVisible(
        'warn',
        'no #volume-pricing-cart-data script tag found on this page — the app embed block is either ' +
          'not enabled in the theme editor, or this script loaded before it rendered.'
      );
      return;
    }

    // Mirrored onto window so it's directly inspectable from the console as
    // `window.VolumePricingConfig`, instead of having to find and
    // JSON.parse the script tag by hand.
    window.VolumePricingConfig = cartData;

    // cart.token is not a real Liquid property (only the AJAX /cart.js
    // response has one), so it's never emitted by the embed — resolved here
    // instead. This mutates the same `cartData` object every closure below
    // already holds a reference to, so no restructuring is needed: whatever
    // reads cartData.cartToken later just sees it populated once this
    // resolves (normally well under the 300-700ms debounce windows below).
    fetch('/cart.js')
      .then(function (res) {
        return res.json();
      })
      .then(function (liveCart) {
        cartData.cartToken = (liveCart && liveCart.token) || null;
      })
      .catch(function (err) {
        logVisible('error', 'failed to resolve cart token via /cart.js', err && err.message);
      });

    if (!Array.isArray(cartData.cartItems) || cartData.cartItems.length === 0) {
      // The #1 cause of "nothing ever happens" reports: none of the products
      // currently in the cart have a populated custom.volume_pricing
      // metafield, so there's nothing to show a tier for — and, critically,
      // this return happens before any listener/observer/discount-sync is
      // ever wired up. Visible (not debug) because it fully explains a
      // "frontend running but zero backend requests" symptom on its own.
      logVisible(
        'warn',
        'no cart line currently has a populated custom.volume_pricing metafield — the discount-code ' +
          'lifecycle will not run at all until at least one does. Re-sync the product(s) in the cart if ' +
          'you expect them to carry volume tiers.',
        cartData
      );
      return;
    }

    var byKey = {};
    var byProductId = {};
    for (var i = 0; i < cartData.cartItems.length; i++) {
      var item = cartData.cartItems[i];
      byKey[item.key] = item;
      byProductId[item.productId] = item;
    }
    if (!cartData.proxyPath) {
      // cartToken is deliberately still unset at this exact point (resolved
      // asynchronously via /cart.js above), so it's not checked here — the
      // timing-correct check lives in syncDynamicDiscount, by which point
      // the debounce window has given that fetch time to resolve.
      logVisible(
        'warn',
        'proxyPath missing from #volume-pricing-cart-data — the storefront is likely running an outdated ' +
          '(not yet redeployed) copy of the embed block. The discount-code lifecycle is disabled until ' +
          'this is fixed; price display below is unaffected.',
        cartData
      );
    }

    // Returns { saved, line } — saved rolls into the cart subtotal + savings
    // badge, line feeds the discount-code sync's cart snapshot — or null if
    // this row can't be matched to a tiered cart item at all.
    function updateRow(row) {
      var item = findCartItemForRow(row, byKey, byProductId);
      if (!item) {
        log('cart: could not match this row to any tiered cart item', row);
        return null;
      }

      var tiers = sortTiersDescending(item.tiers);
      var quantityInput = row.querySelector(QUANTITY_SELECTOR);
      var quantity = quantityInput
        ? Math.max(1, parseInt(quantityInput.value, 10) || 1)
        : Math.max(1, Number(item.quantity) || 1);
      var tier = findQualifyingTier(tiers, quantity);
      var basePrice = Number(item.basePrice) || 0;
      var qualifies = Boolean(tier) && Number(tier.price) < basePrice;
      var unitPrice = qualifies ? Number(tier.price) : basePrice;

      var unitEl = findDawnUnitPriceElement(row);
      if (unitEl) {
        renderAmount(unitEl, basePrice, unitPrice, qualifies, cartData.currencySymbol);
      }

      var lineTotalEls = row.querySelectorAll(LINE_TOTAL_SELECTOR);
      var originalLineTotal = quantity * basePrice;
      var discountedLineTotal = quantity * unitPrice;

      if (lineTotalEls.length > 0) {
        for (var k = 0; k < lineTotalEls.length; k++) {
          // Stacked (discounted on top, strikethrough below) — this cell
          // has no separate label to share space with, unlike the subtotal
          // row, but the two amounts still shouldn't compete side by side.
          renderStackedAmount(
            lineTotalEls[k],
            originalLineTotal,
            discountedLineTotal,
            qualifies,
            cartData.currencySymbol
          );
        }
      } else if (!unitEl) {
        // Neither precise Dawn target matched — likely a different theme.
        // Fall back to the generic broad selector/money-scan, applying
        // unit-price math only: without knowing a theme's markup we can't
        // reliably tell a line-total element apart from a unit-price one.
        var fallbackEls = row.querySelectorAll(CART_PRICE_SELECTOR);
        if (fallbackEls.length === 0) fallbackEls = findMoneyElements(row);
        if (fallbackEls.length === 0) {
          console.warn(
            LOG_PREFIX +
              ' matched product ' +
              item.productId +
              ' to a cart row but found no price element to update — ' +
              'this theme’s cart markup needs a selector added.',
            row
          );
          return null;
        }
        log('cart: used generic fallback to find price element(s) in row', fallbackEls.length);
        for (var m = 0; m < fallbackEls.length; m++) {
          renderAmount(fallbackEls[m], basePrice, unitPrice, qualifies, cartData.currencySymbol);
        }
      }

      return {
        saved: qualifies ? originalLineTotal - discountedLineTotal : 0,
        line: { productId: item.productId, quantity: quantity, basePrice: basePrice, tiers: item.tiers },
      };
    }

    function updateSubtotal(totalSaved) {
      var subtotalEl = document.querySelector(SUBTOTAL_SELECTOR);
      var savingsRow = document.querySelector('.' + SAVINGS_ROW_CLASS);

      if (!subtotalEl) {
        log('cart: no subtotal element found — skipping subtotal/savings row update.');
        if (savingsRow) savingsRow.parentNode.removeChild(savingsRow);
        return;
      }

      if (!subtotalEl.hasAttribute(ORIGINAL_HTML_ATTR)) {
        subtotalEl.setAttribute(ORIGINAL_HTML_ATTR, subtotalEl.innerHTML);
      }
      var originalHtml = subtotalEl.getAttribute(ORIGINAL_HTML_ATTR);

      if (totalSaved <= 0) {
        if (subtotalEl.innerHTML !== originalHtml) subtotalEl.innerHTML = originalHtml;
        if (savingsRow) savingsRow.parentNode.removeChild(savingsRow);
        return;
      }

      // Read the original (undiscounted) subtotal from the theme's own
      // server-rendered text rather than re-summing our own per-row totals —
      // that would miss any non-tiered line items also in the cart.
      var scratch = document.createElement('div');
      scratch.innerHTML = originalHtml;
      var subtotalTemplate = scratch.textContent;
      var originalSubtotal = parseMoneyToNumber(subtotalTemplate);
      if (originalSubtotal === null) {
        log('cart: could not parse subtotal text to a number, skipping', subtotalTemplate);
        return;
      }

      var discountedSubtotal = originalSubtotal - totalSaved;
      renderStackedAmount(subtotalEl, originalSubtotal, discountedSubtotal, true, cartData.currencySymbol);

      // Reuse the subtotal's own formatting (currency symbol, thousands
      // separator, trailing ISO code like "AUD") for the savings figure too,
      // instead of a generic "$" + two decimals.
      var savingsValueText = '-' + formatMoneyLike(totalSaved, subtotalTemplate, cartData.currencySymbol);

      if (!savingsRow) {
        savingsRow = document.createElement('div');
        savingsRow.className = SAVINGS_ROW_CLASS;
        savingsRow.innerHTML =
          '<span class="volume-pricing-savings-row__label">Total Savings</span>' +
          '<span class="volume-pricing-savings-row__value"></span>';
        // Insert after the whole label/value row (e.g. Dawn's .totals), not
        // after just the subtotal value — otherwise this becomes a third
        // flex item squeezed into that same row instead of its own row.
        var totalsRow = subtotalEl.closest('.totals') || subtotalEl.parentElement;
        totalsRow.insertAdjacentElement('afterend', savingsRow);
      }

      var valueEl = savingsRow.querySelector('.volume-pricing-savings-row__value');
      if (valueEl && valueEl.textContent !== savingsValueText) {
        valueEl.textContent = savingsValueText;
      }
    }

    function updateAllRows() {
      var rows = document.querySelectorAll(CART_LINE_SELECTOR);
      var totalSaved = 0;
      var discountLines = [];
      for (var i = 0; i < rows.length; i++) {
        var result = updateRow(rows[i]);
        if (result) {
          totalSaved += result.saved;
          discountLines.push(result.line);
        }
      }
      updateSubtotal(totalSaved);
      scheduleDiscountSync(cartData, discountLines);
    }

    updateAllRows();

    // Quantity changes affect the cart-wide subtotal/savings, not just the
    // row that changed, so re-run the full pass rather than just that row.
    document.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !target.matches || !target.matches(QUANTITY_SELECTOR)) return;
      var row = target.closest(CART_LINE_SELECTOR);
      if (row) updateAllRows();
    });
    document.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || !target.matches || !target.matches(QUANTITY_SELECTOR)) return;
      var row = target.closest(CART_LINE_SELECTOR);
      if (row) updateAllRows();
    });

    // Cart drawers (and many themes' cart pages) replace line-item DOM nodes
    // wholesale via AJAX instead of mutating them in place, so a plain event
    // listener on the original nodes wouldn't survive that. Observe for new
    // nodes and re-apply; renderPrice's no-op guard above keeps this from
    // looping on its own writes. Coalesced via requestAnimationFrame since
    // drawer open/close and AJAX re-renders can fire many mutations at once.
    var pendingFrame = null;
    function scheduleUpdateAllRows() {
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(function () {
        pendingFrame = null;
        updateAllRows();
      });
    }

    var observer = new MutationObserver(scheduleUpdateAllRows);
    observer.observe(document.body, { childList: true, subtree: true });

    // Let the module-level fetch interceptor (installed once, below) refresh
    // this cart's rows directly when it sees a /cart/add|change|clear call.
    cartRefreshHandler = scheduleUpdateAllRows;
  }

  function boot() {
    installCartAjaxInterceptor();
    installBrandingFormSubmitHandler();
    initBrandingSelector();
    initProductPage();
    initCart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Theme customizer re-renders a section without a full page reload.
  document.addEventListener('shopify:section:load', boot);
})();
