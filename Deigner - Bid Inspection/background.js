// background.js

const AD_DOMAIN_PATTERNS = [
  "*://*.bid.appnexus.com/*",
  "*://*.ads.pubmatic.com/*",
  "*://*.prebid.adnxs.com/*",
  "*://*.openx.net/v3/prebid/*",
  "*://*.ad.doubleclick.net/gampad/*", // Google Ad Manager (GAM) ad calls
  "*://*.googleads.g.doubleclick.net/pagead/*", // GAM creatives/trackers
  "*://*.casalemedia.com/bid/*",
  "*://*.rubiconproject.com/a/api/info.json*", // Rubicon project
  "*://*.ads.yahoo.com/*",
  "*://*.sharethrough.com/hb/*",
  "*://*.im.eu.bidr.io/bid/prebid/*", // Index Exchange
  "*://*.amazon-adsystem.com/e/dtb/bid*", // Amazon TAM bid endpoint
  "*://*.amazon-adsystem.com/e/cm*", // Amazon TAM creative matching
  "*://*.aax.amazon-adsystem.com/*", // Amazon ad serving
  "*://*.bidder.criteo.com/*",
  "*://*.gumgum.com/ad/*",
  "*://*.lijit.com/*", // Sovrn
  "*://*.bid.ag.ds.adroll.com/*", // AdRoll
  "*://*.adn.insight.ads.vimeo.com/*", // Vimeo (related to programmatic)
  "*://*.adsrvr.org/*", // The Trade Desk
  "*://*.demdex.net/*", // Adobe Audience Manager / Data Management Platform
  "*://*.facebook.com/ads/rdr*", // Facebook Ads (redirects)
  "*://*.px.adnxs.com/*", // AppNexus pixels
  "*://*.sync.go.sonobi.com/*", // Sonobi Sync
  "*://*.contextweb.com/*", // PulsePoint
  "*://*.adform.net/*", // Adform
  "*://*.adblade.com/*", // Adblade
  "*://*.adroll.com/*", // AdRoll
  "*://*.adtechus.com/*", // AdTech US
  "*://*.adthrive.com/*", // AdThrive
  "*://*.adzerk.net/*", // Adzerk
  "*://*.criteo.com/*", // Criteo
  "*://*.districtm.io/*", // District M
  "*://*.gumgum.com/*", // GumGum
  "*://*.indexexchange.com/*", // Index Exchange
  "*://*.openx.com/*", // OpenX
  "*://*.pubmatic.com/*", // PubMatic
  "*://*.rubiconproject.com/*", // Rubicon Project
  "*://*.sovrn.com/*", // Sovrn
  "*://*.triplelift.com/*", // TripleLift
  "*://*.yieldmo.com/*", // Yieldmo
  "*://*.adnxs.com/*", // AppNexus
  // we can add more as we find them, and identify them as being related to our client's needs
];

const capturedRequests = new Map();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const req = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      timeStamp: details.timeStamp,
      tabId: details.tabId,
      requestHeaders: details.requestHeaders || [],
      requestBody: null, // Will attempt to parse below
      responseHeaders: null,
      statusCode: null,
      statusLine: null,
      completed: false,
      error: null
    };

    if (details.method === "POST" && details.requestBody) {
      if (details.requestBody.raw) {
        try {
          const decoder = new TextDecoder("utf-8");
          const body = details.requestBody.raw
            .map((data) => decoder.decode(data.bytes))
            .join('');
          req.requestBody = body;
        } catch (e) {
          req.requestBody = `Error decoding body: ${e.message}`;
          console.warn("Failed to decode request body:", e);
        }
      } else if (details.requestBody.formData) {
        // Convert FormData to a plain object for easier storage/transfer
        const formDataObj = {};
        for (const key in details.requestBody.formData) {
            formDataObj[key] = details.requestBody.formData[key];
        }
        req.requestBody = formDataObj;
      }
    }
    capturedRequests.set(details.requestId, req);
  },
  { urls: AD_DOMAIN_PATTERNS },
  ["requestBody"]
);

chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const req = capturedRequests.get(details.requestId);
    if (req) {
      req.statusCode = details.statusCode;
      req.statusLine = details.statusLine;
      req.responseHeaders = details.responseHeaders;
    }
  },
  { urls: AD_DOMAIN_PATTERNS },
  ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const req = capturedRequests.get(details.requestId);
    if (req) {
      req.completed = true;
      if (!req.statusCode) {
          req.statusCode = details.statusCode;
          req.statusLine = details.statusLine;
      }
    }
  },
  { urls: AD_DOMAIN_PATTERNS }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const req = capturedRequests.get(details.requestId);
    if (req) {
      req.error = details.error;
      req.completed = true;
    }
  },
  { urls: AD_DOMAIN_PATTERNS }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getNetworkAdData") {
    const dataForTab = Array.from(capturedRequests.values()).filter(
        req => req.tabId === message.tabId
    );
    sendResponse(dataForTab);
  } else if (message.action === "clearNetworkAdData") {
    if (message.tabId) {
        Array.from(capturedRequests.values()).forEach(req => {
            if (req.tabId === message.tabId) {
                capturedRequests.delete(req.requestId);
            }
        });
    } else {
        capturedRequests.clear();
    }
    sendResponse({status: "cleared"});
  }
  return true;
});