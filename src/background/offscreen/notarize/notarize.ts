import {
  Presentation as TPresentation,
  Prover as TProver,
    Commit,
    NotaryServer,
    mapStringToRange,
    subtractRanges,
} from 'tlsn-js';
import * as Comlink from 'comlink';
import { calculateRequestSize, calculateResponseSize, isRedirect } from "./request";
import { ActionLogMessage, ActionUpdateCursor } from '../../../lib/comms/runtime';
import { uploadHistory } from '../../../lib/cstradeup';
import { saveHistoryCursor } from '../../../lib/storage/reducer/cstradeup';
import { ActionAddAppSyncedStorageUnitItems, ActionAddAppSyncedTradeupItems } from '../../../lib/comms/app';

const notaryHost = "notary.cstradeup.net";
const wsRoute = `wss://${notaryHost}/ws`
const tlsnRoute = `https://${notaryHost}`

const DEFAULT_PARAMS = {
  ajax: '1',
  'cursor[time]': '0',
  'cursor[time_frac]': '0',
  'cursor[s]': '0',
  'app[]': '730',
};

export function GetParmsFromCursor(cursor: Record<string, string | number>): Record<string, string> {
  return {
    ajax: '1',
    'cursor[time]': String(cursor.time),
    'cursor[time_frac]': String(cursor.time_frac),
    'cursor[s]': String(cursor.s),
    'app[]': '730',
  };
}

const { init, Prover, Presentation, Verifier }: any = Comlink.wrap(
  new Worker(new URL('../worker.ts', import.meta.url)),
);

export const initThreads = async () => {
  await init({
    loggingLevel: 'Warn',
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
};

export async function notarizeSteamRequestAndSendToBackend(
  steamId: string = '76561199557640798', 
  cookie: string = "steamLoginSecure=76561199557640798%7C%7CeyAidHlwIjogIkpXVCIsICJhbGciOiAiRWREU0EiIH0.eyAiaXNzIjogInI6MDAwRV8yNkVDRjI5NV80RDlDRCIsICJzdWIiOiAiNzY1NjExOTk1NTc2NDA3OTgiLCAiYXVkIjogWyAid2ViOmNvbW11bml0eSIgXSwgImV4cCI6IDE3NjM2Mzc3NjgsICJuYmYiOiAxNzU0OTEwMjgwLCAiaWF0IjogMTc2MzU1MDI4MCwgImp0aSI6ICIwMDE1XzI3NDZBMUY3XzQ3RDJDIiwgIm9hdCI6IDE3NTc2NjcwODQsICJydF9leHAiOiAxNzc1OTU2NzIwLCAicGVyIjogMCwgImlwX3N1YmplY3QiOiAiNS4yNDkuMTcuMTY0IiwgImlwX2NvbmZpcm1lciI6ICI1LjI0OS4xNy4xNjQiIH0.FGqsPj5rj-N1dQ1CaSMucERuHlFuwQmNqyNgLeZoeG9d3gDD_3mjPaVN77Zr5RojW010lqJxQ6MK3qdGl2HLBg", 
  auth: string = "",
  requestParams: Record<string, string> = DEFAULT_PARAMS
) {
  // build the fetch URL exactly as the browser will use
  const steamBase = `https://steamcommunity.com/profiles/${steamId}/inventoryhistory/`;
  const search = new URLSearchParams(requestParams).toString();
  let serverURL = `${steamBase}?${search}`;

  // === 1) Use TLSNotary flow to produce presentation ===
  // (This mirrors your TLSNProveOffscreenHandler logic)
  const headers = {
    Connection: 'close',
    Host: 'steamcommunity.com',
    'Accept-Encoding': 'gzip',
    Cookie: cookie,
  };

  await ActionLogMessage("Calculating request/response sizes for notarization");

  const redirect = await isRedirect(serverURL, 'GET', headers);
  if (redirect) {
    serverURL = redirect;
    await ActionLogMessage(`Detected redirect to ${serverURL}, using new URL`);
  }

  const maxSentData = calculateRequestSize(serverURL, 'GET', headers);

  const {cursor, maxRecvData} = await calculateResponseSize(serverURL, 'GET', headers);
  const maxRecvDataWithBuffer = maxRecvData + 3000; // buffer for notarization overhead

  await ActionLogMessage(`Max sent data: ${maxSentData}, max recv data: ${maxRecvDataWithBuffer}`);

  const notary = NotaryServer.from(tlsnRoute);
  
  const prover: TProver = (await new Prover({
    serverDns: 'steamcommunity.com',
    maxRecvData: maxRecvDataWithBuffer,
    maxSentData,
  }))

  const url = await notary.sessionUrl()

  await ActionLogMessage(`Notary session URL: ${url}`);

  await ActionLogMessage("Setting up prover...");

  await prover.setup(url);

  await prover.sendRequest(wsRoute, {
    url: serverURL,
    method: 'GET',
    headers: { 'Accept-Encoding': 'gzip', Cookie: cookie, },
  });

  await ActionLogMessage("Request sent, awaiting response...");

  // transcript includes sent/recv bytes
  const transcript = await prover.transcript();
  const { sent, recv } = transcript;

  await ActionLogMessage(`Transcript sent length: ${sent.length}, recv length: ${recv.length}`);

  // commit: hide sessionid secrets
  const commit: Commit = {
      sent: subtractRanges(
          {start: 0, end: sent.length},
          mapStringToRange([cookie], Buffer.from(sent).toString('utf-8'))
      ),
      recv: [
          {start: 0, end: recv.length},
      ],
  };

  const notarizationOutputs = await prover.notarize(commit);

  await ActionLogMessage("Notarization complete, preparing presentation...");

  const presentation: TPresentation = (await new Presentation({
    attestationHex: notarizationOutputs.attestation,
    secretsHex: notarizationOutputs.secrets,
    notaryUrl: notarizationOutputs.notaryUrl,
    websocketProxyUrl: notarizationOutputs.websocketProxyUrl,
    reveal: { ...commit, server_identity: false },
  }));

  const presentationJSON = await presentation.json();

  await ActionLogMessage("Presentation prepared, sending to backend...");

  const {verified, crafted, moved_to_storage} = await uploadHistory(presentationJSON, auth);

  await ActionLogMessage("Presentation uploaded to backend.");

  if (!verified) {
    throw new Error("Notarization presentation was not verified by backend");
  }

  await ActionAddAppSyncedTradeupItems(crafted);

  await ActionAddAppSyncedStorageUnitItems(moved_to_storage);

  await ActionLogMessage(`Uploaded history verified: ${verified}, crafted: ${crafted}, moved to storage: ${moved_to_storage}`);

  await ActionUpdateCursor(cursor);

  await ActionLogMessage("Cursor updated.");

  return true
}
