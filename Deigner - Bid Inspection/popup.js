/* global chrome */
document.addEventListener('DOMContentLoaded', () => {

  // ------------------ THEME ------------------
  function applyTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');
  }
  chrome.storage.sync.get(['theme'], ({theme}) => { if (theme) applyTheme(theme); });

  // -------------- DOM ELEMENTS ----------------
  const $stats = document.getElementById('stats');
  const tplExport = document.getElementById('exportButton').content.firstElementChild;
  const $prebidTabContent = document.getElementById('prebid-tab');
  const $tamTabContent = document.getElementById('tam-tab');
  const $networkTabContent = document.getElementById('network-tab');
  const $targetingTabContent = document.getElementById('targeting-tab');
  const $idsTabContent = document.getElementById('ids-tab');
  const $settingsTabContent = document.getElementById('settings-tab');
  const $opensinceraTabContent = document.getElementById('opensincera-tab');
  let activeTabId = 'prebid-tab';

  // ============ MAIN DATA COLLECTION ============
  async function run() {
    $stats.textContent = 'Collecting data…';
    clearTabContents();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { $stats.textContent = '❌ No active tab'; return; }

    // ----- Prebid.js and Storage -----
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, world: 'MAIN', args: [2000], func: collector },
      ([inj]) => {
        if (chrome.runtime.lastError) {
          $prebidTabContent.innerHTML = `<p class="error-message">❌ Error: ${chrome.runtime.lastError.message}</p>`;
          return;
        }
        renderPrebidData(inj.result);
        // Pass to IDs tab:
        getCookiesForOrigin(tab.url).then(cookies => {
          renderAssignedIDsData(cookies, inj.result.storage, new URL(tab.url).origin, inj.result.pbjs.userIds || []);
        });
      }
    );

    // ----- Network Data (Background) -----
    const networkData = await chrome.runtime.sendMessage({ action: "getNetworkAdData", tabId: tab.id });
    renderNetworkAdData(networkData);
    renderTamData(networkData);
    renderTargetingData(networkData);
    updateOverallStats(networkData);
  }

  // ============ TAB SWITCHING ============
  function switchTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
    activeTabId = tabId;
    if (tabId === "settings-tab") renderSettingsTab();
    if (tabId === "opensincera-tab") runOpenSinceraTab();
  }
  // Setup tab listeners
  document.querySelectorAll('.tab-button').forEach(button => {
    button.onclick = (e) => switchTab(e.target.dataset.tab);
  });

  // ============ CONTROL BUTTONS ============
  document.getElementById('btn-refresh').onclick = run;
  document.getElementById('btn-clear').onclick = clearAllData;
  document.getElementById('btn-count').onclick = async () => {
    const phrase = document.getElementById('phrase').value.trim();
    if (!phrase) { alert('Enter a phrase'); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, world: 'MAIN', args: [phrase], func: p => {
        const perf = performance.getEntriesByType('resource').map(e => e.name.toLowerCase());
        const count = perf.filter(u => u.includes(p.toLowerCase())).length;
        return { count, total: perf.length };
      }},
      ([r]) => {
        if (chrome.runtime.lastError) {
          alert('Error: ' + chrome.runtime.lastError.message); return;
        }
        alert(`“${phrase}” found in ${r.result.count} of ${r.result.total} resources`);
      }
    );
  };

  // ============ CLEAR AND RESET =============
  async function clearAllData() {
    clearTabContents();
    $stats.textContent = '(cleared)';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.runtime.sendMessage({ action: "clearNetworkAdData", tabId: tab.id });
    run();
  }
  function clearTabContents() {
    $prebidTabContent.innerHTML = '';
    $tamTabContent.innerHTML = '';
    $networkTabContent.innerHTML = '';
    $targetingTabContent.innerHTML = '';
    $idsTabContent.innerHTML = '';
    $opensinceraTabContent.innerHTML = '';
    $settingsTabContent.innerHTML = '';
  }

  // ========== OpenSincera TAB ==========
  async function runOpenSinceraTab() {
    $opensinceraTabContent.innerHTML = 'Loading OpenSincera data...';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      $opensinceraTabContent.innerHTML = '<p class="error-message">No active tab with a URL.</p>'; return;
    }
    const domain = extractRootDomain(tab.url);
    chrome.storage.sync.get(['opensinceraApiKey'], async ({ opensinceraApiKey }) => {
      if (!opensinceraApiKey) {
        $opensinceraTabContent.innerHTML = `<p>Please set your OpenSincera API key in <b>Settings</b> first.</p>`; return;
      }
      try {
        const resp = await fetch(`https://open.sincera.io/api/publishers?domain=${domain}`, {
          headers: { 'Authorization': `Bearer ${opensinceraApiKey}` }
        });
        if (resp.status === 404) {
          $opensinceraTabContent.innerHTML = `<p>No OpenSincera data found for <b>${domain}</b>.</p>`; return;
        }
        if (!resp.ok) throw new Error("OpenSincera API Error: " + resp.statusText);
        const d = await resp.json();
        $opensinceraTabContent.innerHTML = renderOpenSinceraPublisherSection(d);
      } catch (e) {
        $opensinceraTabContent.innerHTML = `<p class="error-message">OpenSincera API Error: ${e.message}</p>`;
      }
    });
  }
  function extractRootDomain(url) {
    try {
      const u = new URL(url);
      const parts = u.hostname.split('.').reverse();
      if (parts.length >= 2) return parts[1] + '.' + parts[0];
      return u.hostname;
    } catch { return url; }
  }
  function renderOpenSinceraPublisherSection(d) {
    return `
    <section>
      <h2>OpenSincera Publisher Stats for <b>${d.name}</b> <span style="font-size:0.8em;font-weight:normal;">(${d.domain})</span></h2>
      <p><em>${d.pub_description || ''}</em></p>
      <table>
        <tr><th>Publisher ID</th><td>${d.publisher_id}</td></tr>
        <tr><th>Status</th><td>${d.status}</td></tr>
        <tr><th>Primary Supply Type</th><td>${d.primary_supply_type}</td></tr>
        <tr><th>Visit Enabled</th><td>${d.visit_enabled ? 'Yes' : 'No'}</td></tr>
        <tr><th>Domain</th><td>${d.domain}</td></tr>
        <tr><th>Slug</th><td>${d.slug}</td></tr>
        <tr><th>Categories</th><td>${(d.categories || []).join(', ')}</td></tr>
        <tr><th>Ads-to-Content Ratio</th><td>${d.avg_ads_to_content_ratio ? (d.avg_ads_to_content_ratio * 100).toFixed(2) + '%' : 'N/A'}</td></tr>
        <tr><th>Avg. Ads in View</th><td>${d.avg_ads_in_view ?? 'N/A'}</td></tr>
        <tr><th>Ad Refresh Rate (s)</th><td>${d.avg_ad_refresh ?? 'N/A'}</td></tr>
        <tr><th>Total Unique GPIDs</th><td>${d.total_unique_gpids ?? 'N/A'}</td></tr>
        <tr><th>ID Absorption Rate</th><td>${d.id_absorption_rate ? (d.id_absorption_rate * 100).toFixed(1) + '%' : 'N/A'}</td></tr>
        <tr><th>Avg. Page Weight (MB)</th><td>${d.avg_page_weight ? d.avg_page_weight.toFixed(2) : 'N/A'}</td></tr>
        <tr><th>Avg. CPU Time (ms)</th><td>${d.avg_cpu ? d.avg_cpu.toFixed(2) : 'N/A'}</td></tr>
        <tr><th>Total Supply Paths</th><td>${d.total_supply_paths ?? 'N/A'}</td></tr>
        <tr><th>Reseller Count</th><td>${d.reseller_count ?? 'N/A'}</td></tr>
        <tr><th>Owner Domain</th><td>${d.owner_domain}</td></tr>
        <tr><th>Last Updated</th><td>${d.updated_at ? new Date(d.updated_at).toLocaleString() : ''}</td></tr>
      </table>
      <p style="font-size:0.9em;color:gray;">Source: OpenSincera (beta)</p>
    </section>
    `;
  }

  // ============ SETTINGS TAB ===========
  function renderSettingsTab() {
    $settingsTabContent.innerHTML = `
      <section>
        <h2>Settings</h2>
        <label>
          <span>OpenSincera API Key:</span>
          <input type="text" id="sinceraApiKey" placeholder="Paste API Key here" style="width:100%">
        </label>
        <button id="saveApiKeyBtn" class="control-button primary" style="margin-top:10px;">Save API Key</button>
        <p id="apiKeyStatus" style="font-size:0.9em;color:gray;margin-top:5px;"></p>
        <hr>
        <label>
          <span>Theme:</span>
          <select id="themeSelect">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>
    `;
    chrome.storage.sync.get(['opensinceraApiKey', 'theme'], ({opensinceraApiKey, theme}) => {
      if (opensinceraApiKey) document.getElementById('sinceraApiKey').value = opensinceraApiKey;
      if (theme) document.getElementById('themeSelect').value = theme;
    });
    document.getElementById('saveApiKeyBtn').onclick = () => {
      const key = document.getElementById('sinceraApiKey').value.trim();
      chrome.storage.sync.set({opensinceraApiKey: key}, () => {
        const el = document.getElementById('apiKeyStatus');
        el.innerHTML = "&#10004; Saved!";
        setTimeout(() => el.textContent = "", 1200);
      });
    };
    document.getElementById('themeSelect').onchange = e => {
      chrome.storage.sync.set({theme: e.target.value}, () => applyTheme(e.target.value));
    };
  }

  // ============ INITIALIZE ============
  switchTab(activeTabId);
  run();

  /* ---------------------------------------------------------------------- */
  async function clearAllData() {
    clearTabContents();
    $stats.textContent = '(cleared)';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      // Clear network data in background script for current tab
      await chrome.runtime.sendMessage({ action: "clearNetworkAdData", tabId: tab.id });
      // Clearing local/session storage would require executing a script in the main world.
      // For now, we'll just clear the displayed data, not the actual storage.
      // Clearing cookies programmatically would require specific deletion by name/domain.
    }
    // Re-run to show current state (likely empty after clear)
    run();
  }

  function clearTabContents() {
    $prebidTabContent.innerHTML = '';
    $tamTabContent.innerHTML = '';
    $networkTabContent.innerHTML = '';
    $targetingTabContent.innerHTML = '';
    $idsTabContent.innerHTML = ''; // NEW
  }

  function switchTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });

    document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
    activeTabId = tabId;
    if (tabId === "settings-tab") renderSettingsTab();
    if (tabId === "opensincera-tab") runOpenSinceraTab();
  }

  function updateOverallStats(networkData) {
      const prebidDetected = $prebidTabContent.innerHTML.includes('Prebid.js Debug') || $prebidTabContent.innerHTML.includes('Ad Units');
      const tamDetected = $tamTabContent.innerHTML.includes('Amazon TAM Bid') && !$tamTabContent.innerHTML.includes('No Amazon TAM bid data');
      const networkReqCount = networkData ? networkData.length : 0;
      const idsDetected = $idsTabContent.innerHTML.includes('Detected IDs') && !$idsTabContent.innerHTML.includes('No identifiable IDs found');


      let statText = 'Data collected.';
      if (prebidDetected) statText += ' Prebid.js: Yes.';
      if (tamDetected) statText += ' TAM: Yes.';
      if (networkReqCount > 0) statText += ` Network Requests: ${networkReqCount}.`;
      else statText += ' Network Requests: None.';
      if (idsDetected) statText += ' IDs: Yes.';

      $stats.textContent = statText;
  }


  /* -------------------------------------------------- */
  /* QUICK NETWORK-PHRASE COUNTER                       */
  /* -------------------------------------------------- */
  document.getElementById('btn-count').onclick = async () => {
    const phrase = document.getElementById('phrase').value.trim();
    if (!phrase) { alert('Enter a phrase'); return; }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [phrase],
        func: p => {
          const perf = performance.getEntriesByType('resource')
            .map(e => e.name.toLowerCase());
          const count = perf.filter(u => u.includes(p.toLowerCase())).length;
          return { count, total: perf.length };
        }
      },
      ([r]) => {
        if (chrome.runtime.lastError) {
          alert('Error: ' + chrome.runtime.lastError.message); return;
        }
        alert(`“${phrase}” found in ${r.result.count} of ${r.result.total} resources`);
      }
    );
  };

  /* -------- code executed in page context (for Prebid.js specific data and Storage) -------------------------------- */
  function collector(waitMs) {
    const t0 = performance.now(); let tries = 0;
    return new Promise(res => {
      (async function loop() {
        tries++;
        const pbjsFound = typeof window.pbjs !== 'undefined';
        if (pbjsFound) {
          // If pbjs is found, collect its data, then also collect storage data
          const pbjsData = buildPrebidData();
          const storageData = getPageStorageData();
          return res({ pbjs: pbjsData, storage: storageData });
        }
        if (performance.now() < t0 + waitMs) {
          await new Promise(r => setTimeout(r, 100)); loop();
        } else {
          // If pbjs not found, just collect storage data
          const storageData = getPageStorageData();
          res({ pbjs: { ok: false, reason: 'Prebid.js global object (pbjs) not found on page.' }, storage: storageData });
        }
      })();

      function buildPrebidData() {
        if (typeof pbjs === 'undefined') {
          return { ok: false, reason: 'pbjs object not available during build phase.' };
        }
        try {
          const adUnits = pbjs._adUnits || [];
          const tgt = pbjs.getAdserverTargeting?.() || {};
          const win = pbjs.getAllWinningBids?.() || [];
          const resp = pbjs.getBidResponses?.() || {};
          const cfg = pbjs.getConfig?.() || {};
          const userIds = pbjs.getUserIdsAsEids?.() || [];
          const userConsent = pbjs.getUserConsent?.() || {};
          const bids = Object.values(resp).flatMap(r => r.bids);
          const bidders = [...new Set(bids.map(b => b.bidder))];

          const bidStatusCounts = bids.reduce((acc, bid) => {
            acc[bid.statusMessage] = (acc[bid.statusMessage] || 0) + 1;
            return acc;
          }, {});

          const timedOutBidders = bids.filter(b => b.statusMessage === 'Bid timed out').map(b => b.bidder);
          const uniqueTimedOutBidders = [...new Set(timedOutBidders)];

          return {
            ok: true,
            adUnits: adUnits, targeting: tgt, winningBids: win, bidResponses: resp, config: cfg,
            userIds: userIds, userConsent: userConsent,
            stats: {
              totalBids: bids.length,
              uniqueBidders: bidders.length,
              bidStatusCounts: bidStatusCounts,
              timedOutBidders: uniqueTimedOutBidders,
            },
            meta: { wait: Math.round(performance.now() - t0) }
          };
        } catch (e) {
          return { ok: false, reason: `Error reading Prebid.js data: ${e.message}. Is pbjs_debug=true?` };
        }
      }

      function getPageStorageData() {
          const localStorageData = {};
          try {
              for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  localStorageData[key] = localStorage.getItem(key);
              }
          } catch (e) { /* LocalStorage access denied or error */ }

          const sessionStorageData = {};
          try {
              for (let i = 0; i < sessionStorage.length; i++) {
                  const key = sessionStorage.key(i);
                  sessionStorageData[key] = sessionStorage.getItem(key);
              }
          } catch (e) { /* SessionStorage access denied or error */ }

          return { localStorage: localStorageData, sessionStorage: sessionStorageData };
      }
    });
  }

  /* -------- render helpers for Prebid.js ---------------------------------------------- */
  function renderPrebidData(injResult) {
    const d = injResult.pbjs;
    $prebidTabContent.innerHTML = ''; // Clear only Prebid tab
    if (!d || !d.ok) { noData($prebidTabContent, `Prebid.js: ${d ? d.reason : 'No data received.'}`); return; }

    const s = section('Prebid.js Debug: Core Data', null, $prebidTabContent);
    s.insertAdjacentHTML('beforeend', '<p>Loaded Prebid.js data. For more verbose logging, try loading the page with <code>?pbjs_debug=true</code> in the URL.</p>');

    addAdUnits(d.adUnits, $prebidTabContent);
    addTargeting(d.targeting, $prebidTabContent);
    addWinning(d.winningBids, $prebidTabContent);
    addResponses(d.bidResponses, $prebidTabContent);
    addConfig(d.config, $prebidTabContent);
    addUserIds(d.userIds, $prebidTabContent);
    addUserConsent(d.userConsent, $prebidTabContent);
    addBidStats(d.stats, $prebidTabContent);
  }

  /* -------- render helpers for Network Ad Traffic -------------------------------------- */
  function renderNetworkAdData(networkRequests) {
  $networkTabContent.innerHTML = '';
  if (!networkRequests || networkRequests.length === 0) {
    noData($networkTabContent, 'No ad-related network traffic captured for this tab. Try refreshing the page or navigating around.');
    return;
  }
  // Main summary table
  const s = section('Ad-related Network Requests', null, $networkTabContent);
  const tableRows = networkRequests.map(req => {
    const urlDisplay = req.url.length > 80 ? req.url.substring(0, 77) + '…' : req.url;
    return `
      <tr>
        <td>${req.method}</td>
        <td><span class="type-pill">${req.type}</span></td>
        <td style="max-width:250px;overflow-wrap:break-word;"><a href="${req.url}" target="_blank">${urlDisplay}</a></td>
        <td>${req.statusCode || (req.error ? 'ERR' : '—')}</td>
        <td><button class="show-details-btn" data-request-id="${req.requestId}">Show</button></td>
      </tr>
      <tr class="details-row" id="details-${req.requestId}" style="display:none;"><td colspan="5"></td></tr>
    `;
  }).join('');
  s.insertAdjacentHTML('beforeend', `
    <table class="modern-table">
      <thead>
        <tr><th>Method</th><th>Type</th><th>URL</th><th>Status</th><th>Details</th></tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `);

  // Event handlers for expanding rows
  s.querySelectorAll('.show-details-btn').forEach(btn => {
    btn.onclick = e => {
      const reqId = e.target.dataset.requestId;
      const req = networkRequests.find(r => r.requestId == reqId);
      const detailsRow = s.querySelector(`#details-${reqId}`);
      if (detailsRow.style.display === 'none') {
        detailsRow.style.display = '';
        detailsRow.firstElementChild.innerHTML = `
          <div class="details-panel">
            <div><strong>Request Headers:</strong><pre>${req.requestHeaders?.map(h => `${h.name}: ${h.value}`).join('\n') || 'N/A'}</pre></div>
            <div><strong>Body:</strong><pre>${formatBody(req.requestBody)}</pre></div>
            <div><strong>Response Headers:</strong><pre>${req.responseHeaders?.map(h => `${h.name}: ${h.value}`).join('\n') || 'N/A'}</pre></div>
            <div><strong>Error:</strong> ${req.error || 'None'}</div>
          </div>
        `;
        btn.textContent = 'Hide';
      } else {
        detailsRow.style.display = 'none';
        btn.textContent = 'Show';
      }
    };
  });
}
function formatBody(body) {
  if (!body) return 'N/A';
  try { return JSON.stringify(typeof body === 'string' ? JSON.parse(body) : body, null, 2); }
  catch { return typeof body === 'string' ? body : JSON.stringify(body); }
}

  function showNetworkRequestDetails(requestId, networkRequests, parentSection) {
    const request = networkRequests.find(req => req.requestId === requestId);
    if (!request) return;

    // Remove existing details if any, then append new one
    parentSection.querySelectorAll('.request-details').forEach(el => el.remove());

    const detailsSection = document.createElement('div');
    detailsSection.className = 'request-details';

    let detailsHtml = `
      <h4>Request Details for ID: ${request.requestId}</h4>
      <p><strong>URL:</strong> <a href="${request.url}" target="_blank">${request.url}</a></p>
      <p><strong>Method:</strong> ${request.method}</p>
      <p><strong>Type:</strong> ${request.type}</p>
      <p><strong>Status:</strong> ${request.statusCode || 'N/A'} ${request.statusLine || ''}</p>
      <p><strong>Timestamp:</strong> ${request.timeStamp ? new Date(request.timeStamp).toLocaleString() : 'N/A'}</p>
      <p><strong>Tab ID:</strong> ${request.tabId || 'N/A'}</p>
      <p><strong>Error:</strong> ${request.error || 'None'}</p>
    `;

    detailsHtml += '<h4>Request Headers:</h4><pre>';
    if (request.requestHeaders && request.requestHeaders.length > 0) {
        detailsHtml += request.requestHeaders.map(h => `${h.name}: ${h.value}`).join('\n');
    } else { detailsHtml += 'N/A'; }
    detailsHtml += '</pre>';

    detailsHtml += '<h4>Request Body:</h4><pre>';
    if (request.requestBody) {
        try { // Attempt to pretty print JSON if possible
            if (typeof request.requestBody === 'string') {
                detailsHtml += JSON.stringify(JSON.parse(request.requestBody), null, 2);
            } else { // It's already an object (e.g., formData)
                detailsHtml += JSON.stringify(request.requestBody, null, 2);
            }
        } catch (e) {
            detailsHtml += request.requestBody; // Fallback to raw string
        }
    } else { detailsHtml += 'N/A'; }
    detailsHtml += '</pre>';

    detailsHtml += '<h4>Response Headers:</h4><pre>';
    if (request.responseHeaders && request.responseHeaders.length > 0) {
        detailsHtml += request.responseHeaders.map(h => `${h.name}: ${h.value}`).join('\n');
    } else { detailsHtml += 'N/A'; }
    detailsHtml += '</pre>';

    detailsHtml += '<h4>Response Body:</h4><pre><em>(Direct response body capture is not natively supported by webRequest API in Manifest V3 for all requests due to security. Requires more advanced techniques or a content script with DOM inspection.)</em></pre>';

    detailsSection.innerHTML = detailsHtml;
    parentSection.append(detailsSection);
  }

  /* -------- render helpers for Amazon TAM --------------------------------------------- */
  function renderTamData(networkRequests) {
    $tamTabContent.innerHTML = '';
    const s = section('Amazon TAM Bids', null, $tamTabContent); // No direct export for aggregated TAM data yet

    const tamData = {
        bidRequests: [],
        winningBids: [],
        otherEvents: []
    };

    networkRequests.forEach(req => {
      // TAM Bid Requests (dtb/bid)
      if (req.url.includes('amazon-adsystem.com/e/dtb/bid') && req.method === 'POST' && req.requestBody) {
        try {
          const body = typeof req.requestBody === 'string' ? JSON.parse(req.requestBody) : req.requestBody;
          if (body && body.slots && Array.isArray(body.slots)) {
            body.slots.forEach(slot => {
              const tamBid = {
                  adUnitCode: slot.slotID,
                  bidder: 'amazon',
                  // Attempt to find bid response data within the slot
                  cpm: null, currency: null, size: null, creativeId: null,
                  statusMessage: 'Requested',
                  // Extract ad server targeting from request body if available (e.g., prebid parameters)
                  targeting: parseTamRequestTargeting(body),
                  rawRequestBody: req.requestBody,
                  rawRequestHeaders: req.requestHeaders
              };

              // Check for response details if available (e.g., from a prebid integration or later response)
              // Note: Direct bid responses for TAM are usually server-to-server.
              // We're looking for indicators in the request itself or subsequent ad calls.
              if (slot.mediaType) {
                  if (slot.mediaType.video && slot.mediaType.video.response) {
                      const resp = slot.mediaType.video.response;
                      tamBid.cpm = resp.cpm;
                      tamBid.currency = resp.currency;
                      tamBid.size = `${resp.width}x${resp.height}`;
                      tamBid.creativeId = resp.creativeId;
                      tamBid.statusMessage = 'Bid Received (Video)';
                      tamData.winningBids.push(tamBid);
                  } else if (slot.mediaType.display && slot.mediaType.display.response) {
                      const resp = slot.mediaType.display.response;
                      tamBid.cpm = resp.cpm;
                      tamBid.currency = resp.currency;
                      tamBid.size = `${resp.width}x${resp.height}`;
                      tamBid.creativeId = resp.creativeId;
                      tamBid.statusMessage = 'Bid Received (Display)';
                      tamData.winningBids.push(tamBid);
                  }
              }
              tamData.bidRequests.push(tamBid);
            });
          }
        } catch (e) {
          console.warn("Failed to parse TAM bid request body:", e, req.url, req.requestBody);
          tamData.otherEvents.push({ type: 'Parse Error', url: req.url, error: e.message, raw: req.requestBody });
        }
      }
      // Amazon A9 Ad Serving Requests (aax.amazon-adsystem.com) - These are post-auction.
      else if (req.url.includes('aax.amazon-adsystem.com/') && req.url.includes('/x/ns/')) {
          const params = parseQueryParams(req.url);
          const adDetails = {
              adUnitCode: params.get('slotID') || 'N/A',
              size: params.get('sz') || 'N/A',
              creativeId: params.get('crid') || 'N/A',
              eventType: 'Ad Served',
              url: req.url,
              rawQueryParams: Object.fromEntries(params.entries())
          };
          tamData.otherEvents.push(adDetails);
      }
    });

    if (tamData.bidRequests.length === 0 && tamData.winningBids.length === 0 && tamData.otherEvents.length === 0) {
      noData(s, 'No Amazon TAM related network traffic detected.');
      return;
    }

    s.insertAdjacentHTML('beforeend', `<h3>TAM Bid Requests (${tamData.bidRequests.length})</h3>`);
    if (tamData.bidRequests.length > 0) {
        s.insertAdjacentHTML('beforeend', table(
            ['Ad Unit', 'CPM (if won)', 'Status', 'Targeting'],
            tamData.bidRequests.map(b => [
                b.adUnitCode,
                b.cpm ? b.cpm.toFixed(4) : 'N/A',
                b.statusMessage,
                JSON.stringify(b.targeting) // Display targeting found in request
            ])
        ));
        s.insertAdjacentHTML('beforeend', '<h4>Raw TAM Bid Request Bodies:</h4>');
        tamData.bidRequests.forEach((bid, index) => {
            s.insertAdjacentHTML('beforeend', `<details><summary>Request ${index + 1} for ${bid.adUnitCode}</summary><pre>${
                typeof bid.rawRequestBody === 'string' ? JSON.stringify(JSON.parse(bid.rawRequestBody), null, 2) : JSON.stringify(bid.rawRequestBody, null, 2)
            }</pre></details>`);
        });
    } else { noData(s); }

    s.insertAdjacentHTML('beforeend', `<h3>TAM Ad Serving Events (${tamData.otherEvents.length})</h3>`);
    if (tamData.otherEvents.length > 0) {
        s.insertAdjacentHTML('beforeend', table(
            ['Event Type', 'Ad Unit', 'Size', 'Creative ID', 'URL Snippet'],
            tamData.otherEvents.map(e => [
                e.eventType,
                e.adUnitCode,
                e.size,
                e.creativeId,
                e.url.substring(0, 70) + '...'
            ])
        ));
    } else { noData(s); }

     s.insertAdjacentHTML('beforeend', `
        <h3>Amazon TAM Overview:</h3>
        <p>Amazon TAM (Transparent Ad Marketplace) is primarily a server-to-server (S2S) header bidding solution. This means much of the bidding logic and pricing happens on Amazon's servers, not directly in your browser.</p>
        <p>What you see here are:</p>
        <ul>
            <li><strong>Bid Requests:</strong> Calls made from your browser to Amazon's bid endpoint (<code>/e/dtb/bid</code>). These might contain the ad unit IDs and formats requested.</li>
            <li><strong>Ad Serving Events:</strong> Subsequent calls to Amazon's ad delivery servers (<code>aax.amazon-adsystem.com</code>) that indicate an ad was served. These often contain creative IDs and final ad sizes.</li>
        </ul>
        <p>Direct CPM values for individual bids within the TAM auction are usually not exposed in browser network requests for S2S setups.</p>
    `);
  }

  function parseTamRequestTargeting(requestBody) {
      const targeting = {};
      // Common parameters found in TAM bid request body that might indicate targeting
      if (requestBody.pubdata) {
          try {
              // pubdata can be a stringified JSON or an object
              const pubdata = typeof requestBody.pubdata === 'string' ? JSON.parse(requestBody.pubdata) : requestBody.pubdata;
              for (const key in pubdata) {
                  // Filter for common HB keys or publisher-specific keys
                  if (key.startsWith('hb_') || key.includes('segment') || key.includes('user_id') || key.includes('consent')) {
                      targeting[key] = pubdata[key];
                  }
              }
          } catch (e) { /* silent fail for malformed pubdata */ }
      }
      // Look for GDPR consent in top-level request body if present
      if (requestBody.gdpr) targeting.gdpr = requestBody.gdpr;
      if (requestBody.consentString) targeting.consentString = requestBody.consentString;
      return targeting;
  }

  /* -------- render helpers for User Targeting Transparency --------------------------- */
  function renderTargetingData(networkRequests) {
    $targetingTabContent.innerHTML = '';
    const s = section('User Targeting Transparency', null, $targetingTabContent);

    const detectedTargetingParams = {}; // Store { url: { paramName: value, type: 'url' | 'body' | 'header' } }
    const creativeDetails = []; // Store creative info for rendered ads

    networkRequests.forEach(req => {
      // 1. Target GAM ad calls and other ad serving/bid requests for URL parameters
      if (isAdServingOrBidRequest(req.url)) {
        const urlParams = parseQueryParams(req.url);
        const currentUrlTargeting = {};

        // Common GAM/Prebid targeting parameters
        const commonUrlParams = ['iu_szs', 'cust_params', 'prev_iu_szs', 'correlator', 'gdpr', 'gdpr_consent', 'u_sd', 'npa', 'adx', 'top_ssp'];

        urlParams.forEach((value, key) => {
            if (key === 'cust_params') { // Decipher `cust_params` (custom targeting)
                try {
                    const decodedCustParams = decodeURIComponent(value).replace(/\+/g, ' ');
                    decodedCustParams.split('&').forEach(param => {
                        const [pKey, pVal] = param.split('=');
                        if (pKey && pVal) {
                            currentUrlTargeting[`cust_${pKey}`] = decodeURIComponent(pVal);
                        }
                    });
                } catch (e) {
                    console.warn(`Error decoding cust_params for ${req.url}: ${e.message}`);
                }
            } else if (commonUrlParams.includes(key) || key.startsWith('hb_') || key.startsWith('amzn_')) { // Prebid/Amazon targeting
                currentUrlTargeting[key] = value;
            }
            // Add more heuristics for other common parameters or patterns if needed
        });

        if (Object.keys(currentUrlTargeting).length > 0) {
          detectedTargetingParams[`URL: ${req.url}`] = { type: 'URL', params: currentUrlTargeting };
        }
      }

      // 2. Check Request Bodies for targeting parameters (e.g., bid requests)
      if (req.requestBody) {
        try {
          const body = typeof req.requestBody === 'string' ? JSON.parse(req.requestBody) : req.requestBody;
          const currentBodyTargeting = {};

          // Common patterns in JSON bid request bodies (OpenRTB like)
          if (body.user && body.user.ext) { // OpenRTB user extensions
              for (const key in body.user.ext) {
                  currentBodyTargeting[`user_ext_${key}`] = body.user.ext[key];
              }
          }
          if (body.device && body.device.geo) { // OpenRTB geo targeting
              currentBodyTargeting.geo_lat = body.device.geo.lat;
              currentBodyTargeting.geo_lon = body.device.geo.lon;
              currentBodyTargeting.geo_country = body.device.geo.country;
          }
          if (body.site && body.site.cat) { // OpenRTB site categories
              currentBodyTargeting.site_categories = body.site.cat;
          }
          if (body.app && body.app.cat) { // OpenRTB app categories
              currentBodyTargeting.app_categories = body.app.cat;
          }
          if (body.regs && body.regs.ext && body.regs.ext.gdpr) { // GDPR flag
              currentBodyTargeting.gdpr_reg = body.regs.ext.gdpr;
          }
          if (body.user && body.user.eids) { // User IDs (eIDs)
            currentBodyTargeting.eids = body.user.eids.map(e => `${e.source}:${e.id}`).join(', ');
          }

          // Specific to TAM pubdata
          const tamPubdataTargeting = parseTamRequestTargeting(body);
          Object.assign(currentBodyTargeting, tamPubdataTargeting);

          if (Object.keys(currentBodyTargeting).length > 0) {
            detectedTargetingParams[`Body: ${req.url}`] = { type: 'Body', params: currentBodyTargeting };
          }

        } catch (e) {
          // Log errors for malformed bodies, but don't crash
          console.warn(`Error parsing request body for targeting: ${req.url} - ${e.message}`);
        }
      }

      // 3. Extract Creative Details from Ad Serving URLs
      if (req.url.includes('googleads.g.doubleclick.net/pagead/adview')) {
          const params = parseQueryParams(req.url);
          const creativeInfo = {
              url: req.url,
              creativeId: params.get('ad_id') || params.get('crid') || 'N/A',
              size: params.get('sz') || 'N/A',
              impressionUrl: req.url, // This request is usually the impression tracker
              // Add more as discovered
          };
          creativeDetails.push(creativeInfo);
      }
      // Add other ad platforms' creative URL patterns here
      else if (req.url.includes('aax.amazon-adsystem.com/') && req.url.includes('/x/ns/')) {
          const params = parseQueryParams(req.url);
          const creativeInfo = {
              url: req.url,
              creativeId: params.get('crid') || 'N/A',
              size: params.get('sz') || 'N/A',
              impressionUrl: req.url,
          };
          creativeDetails.push(creativeInfo);
      }

    });

    if (Object.keys(detectedTargetingParams).length === 0 && creativeDetails.length === 0) {
      noData(s, 'No explicit user targeting parameters or creative details found in network requests.');
      return;
    }

    // Display Targeting Parameters
    if (Object.keys(detectedTargetingParams).length > 0) {
        s.insertAdjacentHTML('beforeend', '<h3>Detected Ad Server/Bid Request Targeting Parameters</h3>');
        for (const key in detectedTargetingParams) {
          const { type, params } = detectedTargetingParams[key];
          s.insertAdjacentHTML('beforeend', `<details><summary>${type} Parameters: ${key.substring(0, 120)}...</summary>${
            table(['Parameter', 'Value'], Object.entries(params))
          }</details>`);
        }
    }

    // Display Creative Details
    if (creativeDetails.length > 0) {
        s.insertAdjacentHTML('beforeend', '<h3>Detected Ad Creatives</h3>');
        s.insertAdjacentHTML('beforeend', table(
            ['Creative ID', 'Size', 'Ad Serving URL'],
            creativeDetails.map(c => [c.creativeId, c.size, `<a href="${c.url}" target="_blank">${c.url.substring(0, 80)}...</a>`])
        ));
         s.insertAdjacentHTML('beforeend', '<p>The "Ad Serving URL" is often the URL that triggers the final ad impression. Examining these URLs can sometimes reveal details about the served creative or its tracking.</p>');
    }


    s.insertAdjacentHTML('beforeend', `
        <h3>What Does This Mean?</h3>
        <p>This section attempts to show the data points that are sent about you or the page you are on to various ad servers and bidders. This information helps them decide which ads to serve.</p>
        <ul>
            <li><code>cust_...</code>: Custom targeting parameters, often sent by the publisher. These can include anything from user segments (e.g., 'gender=male', 'interest=sports') to page categories (e.g., 'news', 'finance'), or even hashed user IDs.</li>
            <li><code>hb_...</code> / <code>amzn_...</code>: Header bidding parameters from Prebid.js or Amazon TAM (e.g., <code>hb_pb</code> for bid price, <code>hb_bidder</code> for winning bidder).</li>
            <li><code>gdpr</code> / <code>gdpr_consent</code>: Indicates if GDPR applies and carries your consent string.</li>
            <li><code>npa</code>: "Non-Personalized Ads" flag.</li>
            <li><code>user_ext_...</code> / <code>geo_...</code>: Parameters from OpenRTB bid requests, often related to user IDs, demographics, or geographic location.</li>
            <li><strong>Creative ID:</strong> A unique identifier for the specific ad creative that was shown.</li>
        </ul>
        <p><strong>Your data is being used to make ad decisions.</strong> While this tool shows what's in plain sight, much more complex data processing happens behind the scenes. This information helps you understand what signals are being sent about you for ad targeting and what ads are being served based on those signals.</p>
    `);
  }

  // Helper to check if a URL is likely an ad serving or bid request based on patterns
  function isAdServingOrBidRequest(url) {
      return url.includes('doubleclick.net/gampad/ads') ||
             url.includes('aax.amazon-adsystem.com/') ||
             url.includes('bid.appnexus.com') ||
             url.includes('ads.pubmatic.com') ||
             url.includes('openx.net') ||
             url.includes('rubiconproject.com') ||
             url.includes('criteo.com/bid') ||
             url.includes('lijit.com'); // Add more known ad serving domains here
  }

  /* -------- NEW: Assigned IDs Tab ------------------------------------------------ */
  async function renderAssignedIDsData(cookies, storageData, pageOrigin) {
    $idsTabContent.innerHTML = '';
    const s = section('Detected IDs and Local Storage Data', null, $idsTabContent);

    let hasData = false;

    // Cookies
    if (cookies && cookies.length > 0) {
      hasData = true;
      s.insertAdjacentHTML('beforeend', `<h3>Browser Cookies (${cookies.length})</h3>`);
      s.insertAdjacentHTML('beforeend', `<p>These are cookies stored by various domains you've visited. They can be used to track you across sites. Note: <code>HttpOnly</code> cookies are not accessible via JavaScript for security.</p>`);
      s.insertAdjacentHTML('beforeend', table(
        ['Name', 'Value', 'Domain', 'Path', 'Expires', 'Secure', 'HttpOnly', 'SameSite'],
        cookies.map(c => [
          c.name,
          c.value,
          c.domain,
          c.path,
          c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleString() : 'Session',
          c.secure ? 'Yes' : 'No',
          c.httpOnly ? 'Yes' : 'No',
          c.sameSite
        ])
      ));
    }

    // Local Storage
    if (storageData.localStorage && Object.keys(storageData.localStorage).length > 0) {
      hasData = true;
      s.insertAdjacentHTML('beforeend', `<h3>Local Storage (${Object.keys(storageData.localStorage).length} entries)</h3>`);
      s.insertAdjacentHTML('beforeend', `<p>Data stored by the current website (${pageOrigin}) that persists across sessions. Often used for user preferences or local tracking.</p>`);
      s.insertAdjacentHTML('beforeend', table(
        ['Key', 'Value (Truncated)'],
        Object.entries(storageData.localStorage).map(([key, value]) => [key, value.substring(0, 200) + (value.length > 200 ? '...' : '')])
      ));
      s.insertAdjacentHTML('beforeend', '<details><summary>View Raw Local Storage JSON</summary><pre>' + JSON.stringify(storageData.localStorage, null, 2) + '</pre></details>');
    }

    // Session Storage
    if (storageData.sessionStorage && Object.keys(storageData.sessionStorage).length > 0) {
      hasData = true;
      s.insertAdjacentHTML('beforeend', `<h3>Session Storage (${Object.keys(storageData.sessionStorage).length} entries)</h3>`);
      s.insertAdjacentHTML('beforeend', `<p>Data stored by the current website (${pageOrigin}) that only persists for the current Browse session.</p>`);
      s.insertAdjacentHTML('beforeend', table(
        ['Key', 'Value (Truncated)'],
        Object.entries(storageData.sessionStorage).map(([key, value]) => [key, value.substring(0, 200) + (value.length > 200 ? '...' : '')])
      ));
      s.insertAdjacentHTML('beforeend', '<details><summary>View Raw Session Storage JSON</summary><pre>' + JSON.stringify(storageData.sessionStorage, null, 2) + '</pre></details>');
    }

    // Attempt to match Prebid eIDs to cookies/storage
    // We already have the inj.result from the run() function, no need to re-execute collector here.
    // We just need to access the stored pbjs userIds.
    // Since this function is called after the main `executeScript` completes,
    // we need a way to pass the Prebid data from `run()` to `renderAssignedIDsData`.
    // The easiest way is to adjust `run()` to make `inj.result` (which contains `pbjs` and `storage`) available
    // when calling `renderAssignedIDsData`.

    // For now, let's assume `run()` passes `inj.result.pbjs.userIds` directly or we derive it from renderPrebidData.
    // The current `renderAssignedIDsData` does not directly receive `pbjs.userIds`.
    // Let's modify `run()` to pass the `inj.result` to `renderAssignedIDsData`
    // and `renderAssignedIDsData` will extract `pbjs.userIds` from it.
    // Or, simpler, the `collector` already gives us `pbjs.userIds` via `inj.result.pbjs.userIds`
    // which is available in the `run` callback.
    // The fix will involve removing the re-execution of `collector` here and using the `userIds` collected earlier.

    // This section needs the Prebid User IDs.
    // The `run` function's `chrome.scripting.executeScript` callback
    // has `inj.result` which contains `pbjs` data.
    // We need to pass that `inj.result.pbjs.userIds` to this function.

    // TEMPORARY placeholder for prebidUserIds until `run` is adjusted to pass it properly
    // In a real application, you would store `inj.result` in a global/module variable
    // or pass it explicitly.
    // For this demonstration, I'll pass it as an argument when `renderAssignedIDsData` is called.



    // ALL IN ALL THIS IS NONSENSE but oh well. We ball
    const prebidUserIds = window.__prebidUserIds || []; // This needs to be populated by `run`

    // Assuming prebidUserIds are passed correctly from `run`
    // The change is in `run()` to pass `inj.result.pbjs.userIds`
    // or the entire `inj.result` to this function.
    // For demonstration, I will adjust `run` to pass `prebidUserIds` to this function.

    // Let's refine `run()`'s callback to pass `pbjsUserIds` to `renderAssignedIDsData`.
    // The original `renderAssignedIDsData(cookies, storageData, pageOrigin)` only received
    // `cookies`, `storageData`, and `pageOrigin`.
    // We need to add `prebidUserIds` as a new parameter.
    // So, this part of the code below will work once `run` is adjusted.

    // but sometimes a fool's gotta eat and a fool's gotta code, sometimes a fool's gotta do both at the same time <- AWS Q Wrote that, how insane is that???

    if (prebidUserIds.length > 0) {
        hasData = true;
        s.insertAdjacentHTML('beforeend', `<h3>Prebid.js User IDs (eIDs) Matched</h3>`);
        s.insertAdjacentHTML('beforeend', `<p>Prebid.js often generates or uses identifiers from various sources. We attempt to match these eIDs to accessible cookies or local/session storage entries.</p>`);

        const matchedIds = [];
        prebidUserIds.forEach(eid => {
            let matchedSource = 'Not Found in Accessible Storage';
            let matchedValue = 'N/A';

            // Check cookies
            // Relaxing the match for common eID cookie patterns
            // Example: _sharedid (SharedID), _pubcid (PubCommonID), ttd_id (The Trade Desk), etc.
            const cookieMatch = cookies.find(c =>
                c.name.toLowerCase() === eid.source.toLowerCase() ||
                c.name.toLowerCase().includes(eid.source.toLowerCase()) ||
                eid.source.toLowerCase().includes(c.name.toLowerCase()) ||
                (eid.ext && eid.ext.type && c.name.toLowerCase().includes(eid.ext.type.toLowerCase()))
            );

            if (cookieMatch) {
                matchedSource = `Cookie: ${cookieMatch.name} (Domain: ${cookieMatch.domain})`;
                matchedValue = cookieMatch.value;
            }

            // Check local storage
            if (!cookieMatch && storageData.localStorage) {
                const localStorageKey = Object.keys(storageData.localStorage).find(k =>
                    k.toLowerCase().includes(eid.source.toLowerCase()) ||
                    eid.source.toLowerCase().includes(k.toLowerCase()) ||
                    (eid.ext && eid.ext.type && k.toLowerCase().includes(eid.ext.type.toLowerCase()))
                );
                if (localStorageKey) {
                    matchedSource = `Local Storage: ${localStorageKey}`;
                    matchedValue = storageData.localStorage[localStorageKey];
                }
            }

            // Check session storage
            if (!cookieMatch && !matchedSource.startsWith('Local Storage') && storageData.sessionStorage) {
                 const sessionStorageKey = Object.keys(storageData.sessionStorage).find(k =>
                    k.toLowerCase().includes(eid.source.toLowerCase()) ||
                    eid.source.toLowerCase().includes(k.toLowerCase()) ||
                    (eid.ext && eid.ext.type && k.toLowerCase().includes(eid.ext.type.toLowerCase()))
                );
                if (sessionStorageKey) {
                    matchedSource = `Session Storage: ${sessionStorageKey}`;
                    matchedValue = storageData.sessionStorage[sessionStorageKey];
                }
            }

            matchedIds.push({
                source: eid.source,
                id: eid.id,
                matchedSource: matchedSource,
                matchedValue: matchedValue.substring(0, 150) + (matchedValue.length > 150 ? '...' : '')
            });
        });

        if (matchedIds.length > 0) {
            s.insertAdjacentHTML('beforeend', table(
                ['eID Source', 'eID Value', 'Matched Storage Type', 'Matched Storage Value'],
                matchedIds.map(m => [m.source, m.id, m.matchedSource, m.matchedValue])
            ));
        } else {
             s.insertAdjacentHTML('beforeend', '<p><em>No Prebid.js eIDs could be explicitly matched to directly accessible cookies or storage entries. They might be stored as HttpOnly cookies, in inaccessible iframes, or generated dynamically.</em></p>');
        }
    }


    if (!hasData) {
      noData(s, 'No identifiable IDs found in cookies, local storage, or session storage for this page/origin.');
    }

    s.insertAdjacentHTML('beforeend', `
        <h3>Understanding Assigned IDs</h3>
        <p>Websites and ad tech companies assign unique identifiers (IDs) to your browser or device. These IDs are stored in various places:</p>
        <ul>
            <li><strong>Cookies:</strong> Small files stored by websites in your browser. They can be first-party (from the site you're visiting) or third-party (from other domains, often ad tech companies). They are used for tracking, personalization, and maintaining sessions.</li>
            <li><strong>Local Storage & Session Storage:</strong> Browser-based storage mechanisms that allow websites to save data directly in your browser. Local storage persists across sessions, while session storage is cleared when you close the tab.</li>
            <li><strong>Prebid.js User IDs (eIDs):</strong> These are "enriched IDs" from various identity providers (e.g., LiveRamp, The Trade Desk, PubCommon ID) that Prebid.js collects and sends to bidders for more accurate targeting.</li>
        </ul>
        <p>These IDs are crucial for tracking your Browse behavior, showing you targeted ads, and recognizing you across different visits or websites. Understanding them provides a key insight into how ad transparency works.</p>
    `);
  }

  // --- Utility functions for getting browser storage ---
  async function getCookiesForOrigin(url) {
    try {
      const cookies = await chrome.cookies.getAll({ url: url });
      return cookies;
    } catch (e) {
      console.error("Error fetching cookies:", e);
      return [];
    }
  }

  // getLocalStorageAndSessionStorage is no longer explicitly called from `run` outside the collector,
  // as the collector already returns this data.
  // However, we keep this function here for conceptual understanding and future use if needed.
  // We keep this function for conceptual understanding, but it's merged into `collector`'s `getPageStorageData`.
  // Let me know if youre actually reading this and want to learn more, because honestly I'd be impressed that you're in here.
  
  /*
  async function getLocalStorageAndSessionStorage(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN', // Crucial to access page's localStorage/sessionStorage
            func: () => {
                const localStorageData = {};
                try {
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        localStorageData[key] = localStorage.getItem(key);
                    }
                } catch (e) { // LocalStorage access denied or error }

                const sessionStorageData = {};
                try {
                    for (let i = 0; i < sessionStorage.length; i++) {
                        const key = sessionStorage.key(i);
                        sessionStorageData[key] = sessionStorage.getItem(key);
                    }
                } catch (e) { // SessionStorage access denied or error }

                return { localStorage: localStorageData, sessionStorage: sessionStorageData };
            }
        });
        return results[0]?.result || { localStorage: {}, sessionStorage: {} };
    } catch (e) {
        console.error("Error fetching local/session storage:", e);
        return { localStorage: {}, sessionStorage: {} };
    }
  }
  */

  /* -------- General render helpers ---------------------------------------------- */
  const noData = (targetEl, message = '(none)') => targetEl.insertAdjacentHTML('beforeend', `<p class="no-data-message"><em>${message}</em></p>`);
  const section = (t, raw, targetEl) => {
    const s = document.createElement('section'); s.innerHTML = `<h2>${t}</h2>`;
    if (raw) { const b = tplExport.cloneNode(true); b.onclick = () => download(t, raw); s.querySelector('h2').append(b); }
    targetEl.append(s); return s;
  };
  const download = (name, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); Object.assign(document.createElement('a'),
      { href: url, download: `${name.replace(/\s+/g, '_')}.json` }).click(); URL.revokeObjectURL(url);
  };

  /* tables ---------------------------------------------------------------- */
  function addAdUnits(u, targetEl) {
    const s = section('Prebid.js Ad Units', u, targetEl); if (!u.length) { noData(s); return; }
    s.insertAdjacentHTML('beforeend', table(
      ['Code', 'Media Types', 'Bidders', 'Sizes'],
      u.map(x => [
        x.code,
        Object.keys(x.mediaTypes || {}).join(', '),
        x.bids.map(b => b.bidder).join(', '),
        [...new Set(
          (x.sizes || []).map(z => z.join('×'))
            .concat(...Object.values(x.mediaTypes || {}).flatMap(mt => mt.sizes || []).map(z => z.join('×')))
        )].join(' , ')
      ])
    ));
  }
  function addTargeting(t, targetEl) {
    const s = section('Prebid.js Ad Server Targeting', t, targetEl); const codes = Object.keys(t);
    if (!codes.length) { noData(s); return; }
    codes.forEach(c => {
      s.insertAdjacentHTML('beforeend', `<details open><summary>${c}</summary>${
        table(['Key', 'Val'], Object.entries(t[c]))}</details>`);
    });
  }
  function addWinning(b, targetEl) {
    const s = section('Prebid.js Winning Bids', b, targetEl); if (!b.length) { noData(s); return; }
    s.insertAdjacentHTML('beforeend', table(
      ['Unit', 'Bidder', 'CPM', 'Cur.', 'Size', 'Creative'],
      b.map(x => [x.adUnitCode, x.bidder, x.cpm.toFixed(4), x.currency, x.size, x.creativeId])
    ));
  }
  function addResponses(r, targetEl) {
    const s = section('Prebid.js All Bid Responses', r, targetEl); const codes = Object.keys(r);
    if (!codes.length) { noData(s); return; }
    codes.forEach(c => {
      s.insertAdjacentHTML('beforeend', `<details><summary>${c} (${r[c].bids.length} bids)</summary>${
        table(['Bidder', 'CPM', 'Cur.', 'Status', 'T(ms)', 'Size', 'Creative'],
          r[c].bids.map(b => [b.bidder, b.cpm ? b.cpm.toFixed(4) : 'N/A', b.currency, b.statusMessage, b.timeToRespond, b.size, b.creativeId]))
      }</details>`);
    });
  }
  function addConfig(cfg, targetEl) {
    const s = section('Prebid.js Configuration', cfg, targetEl); if (!Object.keys(cfg).length) { noData(s); return; }
    const prim = Object.entries(cfg).filter(([k, v]) => typeof v !== 'object');
    if (prim.length) s.insertAdjacentHTML('beforeend', table(['Key', 'Val'], prim));
    Object.entries(cfg).filter(([k, v]) => typeof v === 'object')
      .forEach(([k, v]) => s.insertAdjacentHTML('beforeend', `<details><summary>${k}</summary><pre>${JSON.stringify(v, null, 2)}</pre></details>`));
  }
  function addUserIds(ids, targetEl) {
    const s = section('Prebid.js User IDs (eIDs)', ids, targetEl); if (!ids.length) { noData(s); return; }
    s.insertAdjacentHTML('beforeend', table(
      ['Source', 'ID', 'Ext. Type', 'Ext. Data'],
      ids.map(x => [
        x.source,
        x.id,
        x.ext && x.ext.type ? x.ext.type : '',
        x.ext && x.ext.data ? JSON.stringify(x.ext.data) : ''
      ])
    ));
  }
  function addUserConsent(consent, targetEl) {
    const s = section('Prebid.js User Consent (GDPR/CCPA)', consent, targetEl);
    if (Object.keys(consent).length === 0) { noData(s); return; }
    s.insertAdjacentHTML('beforeend', '<pre>' + JSON.stringify(consent, null, 2) + '</pre>');
  }
  function addBidStats(stats, targetEl) {
    const s = section('Prebid.js Bid Statistics', stats, targetEl);
    if (Object.keys(stats).length === 0) { noData(s); return; }

    s.insertAdjacentHTML('beforeend', '<h3>Bid Status Distribution</h3>');
    if (Object.keys(stats.bidStatusCounts).length > 0) {
      s.insertAdjacentHTML('beforeend', table(
        ['Status', 'Count'],
        Object.entries(stats.bidStatusCounts)
      ));
    } else { noData(s); }

    s.insertAdjacentHTML('beforeend', '<h3>Timed Out Bidders</h3>');
    if (stats.timedOutBidders && stats.timedOutBidders.length > 0) {
      s.insertAdjacentHTML('beforeend', `<p>${stats.timedOutBidders.join(', ')}</p>`);
    } else { noData(s); }
  }


  function table(head, rows) {
    const h = head.map(x => `<th>${x}</th>`).join('');
    // Sanitize cell content to prevent XSS if you're directly inserting user-controlled strings without escaping.
    // For now, it assumes content is safe or handled by `innerHTML` in a controlled way.
    const r = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<table><thead><tr>${h}</tr></thead><tbody>${r}</tbody></table>`;
  }

  // Helper to parse query parameters from a URL string
  function parseQueryParams(url) {
      try {
          const queryString = url.split('?')[1];
          return queryString ? new URLSearchParams(queryString) : new URLSearchParams();
      } catch (e) {
          console.error("Failed to parse URL query params:", url, e);
          return new URLSearchParams();
      }
  }

  document.getElementById('saveApiKeyBtn').onclick = () => {
    const key = document.getElementById('sinceraApiKey').value.trim();
    chrome.storage.sync.set({opensinceraApiKey: key}, () => {
        const el = document.getElementById('apiKeyStatus');
        el.innerHTML = "&#10004; Saved!";
        setTimeout(() => el.textContent = "", 1200);
    });
};

  function log(...a) { console.log('🟦[Ad Transparency Inspector]', ...a); }
}); // This closing brace is correct for the DOMContentLoaded listener.
// super messy but it works, and I don't have time to refactor it right now.
// If you want to refactor it, please do so and make it cleaner
// remember
// Keep it Metal
// Keep it Heavy
// Real Instruments