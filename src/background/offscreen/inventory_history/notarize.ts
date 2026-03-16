import {
  Presentation as TPresentation,
  Prover as TProver,
  Commit,
  NotaryServer,
  mapStringToRange,
  subtractRanges,
} from "tlsn-js";
import * as Comlink from "comlink";

import { calculateRequestSize, calculateResponseSize } from "./request";
import { ActionLogMessage } from "../../../lib/comms/runtime";
import { uploadSignedHistory } from "../../../lib/cstradeup";
import {
  ActionAddNotarizedTradeupItems,
} from "../../../lib/comms/app";
import { buildCookie, buildHeaders, DEFAULT_HISTORY_PARAMS, HistoryParams, NotarizationResult, STEAM_CONFIG } from "./helpers";

// =============================================================================
// Configuration
// =============================================================================

const NOTARY_CONFIG = {
  host: "notary.cstradeup.net",
  get wsRoute() {
    return `wss://${this.host}/ws`;
  },
  get tlsnRoute() {
    return `https://${this.host}`;
  },
} as const;

// =============================================================================
// Worker Initialization
// =============================================================================

const { init, Prover, Presentation }: any = Comlink.wrap(
  new Worker(new URL("../worker.ts", import.meta.url))
);

export async function initThreads(): Promise<void> {
  await init({
    loggingLevel: "Warn",
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
}

// =============================================================================
// Notarization
// =============================================================================

async function notarizeRequest(
  url: string,
  cookie: string
): Promise<{ presentationJSON: unknown }> {
  const headers = buildHeaders(cookie);

  await ActionLogMessage("[Notary]: Calculating request/response sizes for notarization");

  const maxSentData = calculateRequestSize(url, "GET", headers);
  const { maxRecvData } = await calculateResponseSize(url, "GET", headers);
  const maxRecvDataWithBuffer = maxRecvData + 3000; // Buffer for notarization overhead

  await ActionLogMessage(`[Notary]: Max sent data: ${maxSentData}, max recv data: ${maxRecvDataWithBuffer}`);

  // Initialize notary and prover
  const notary = NotaryServer.from(NOTARY_CONFIG.tlsnRoute);

  const prover: TProver = await new Prover({
    serverDns: STEAM_CONFIG.host,
    maxRecvData: maxRecvDataWithBuffer,
    maxSentData,
  });

  const sessionUrl = await notary.sessionUrl();
  await ActionLogMessage(`[Notary]: Notary session URL: ${sessionUrl}`);

  await ActionLogMessage("[Notary]: Setting up prover...");
  await prover.setup(sessionUrl);

  // Send the request through the prover
  await prover.sendRequest(NOTARY_CONFIG.wsRoute, {
    url,
    method: "GET",
    headers: { "Accept-Encoding": "gzip", Cookie: cookie },
  });

  await ActionLogMessage("[Notary]: Request sent, awaiting response...");

  // Get transcript
  const transcript = await prover.transcript();
  const { sent, recv } = transcript;

  await ActionLogMessage(`[Notary]: Transcript sent length: ${sent.length}, recv length: ${recv.length}`);

  // Build commit - hide session secrets
  const commit: Commit = {
    sent: subtractRanges(
      { start: 0, end: sent.length },
      mapStringToRange([cookie], Buffer.from(sent).toString("utf-8"))
    ),
    recv: [{ start: 0, end: recv.length }],
  };

  // Notarize
  const notarizationOutputs = await prover.notarize(commit);

  await ActionLogMessage("[Notary]: Notarization complete, preparing presentation...");

  // Create presentation
  const presentation: TPresentation = await new Presentation({
    attestationHex: notarizationOutputs.attestation,
    secretsHex: notarizationOutputs.secrets,
    notaryUrl: notarizationOutputs.notaryUrl,
    websocketProxyUrl: notarizationOutputs.websocketProxyUrl,
    reveal: { ...commit, server_identity: false },
  });

  const presentationJSON = await presentation.json();

  await ActionLogMessage("[Notary]: Presentation prepared");

  return { presentationJSON };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Processes Steam inventory history with conditional notarization.
 *
 * Flow:
 * 1. Notalizes a specific inventory history cursor request
 * 2. Uploads the signed presentation to the backend to check if it's verified
 *
 * @param profileBaseUrl - Pre-resolved Steam profile base URL (redirect already handled)
 * @param token - Steam login token
 * @param auth - Backend auth token
 * @param requestParams - Cursor parameters for pagination
 */
export async function notarizeSteamRequestAndSendToBackend(
  profileBaseUrl: string,
  token: string,
  auth: string,
  requestParams: HistoryParams = DEFAULT_HISTORY_PARAMS,
): Promise<NotarizationResult> {
  const cookie = buildCookie(token);
  const search = new URLSearchParams(requestParams as Record<string, string>).toString();
  const url = `${profileBaseUrl}${STEAM_CONFIG.inventoryHistoryPath}?${search}`;


  const { presentationJSON } = await notarizeRequest(url, cookie);

  await ActionLogMessage("Uploading signed presentation to backend...");
  const signedResult = await uploadSignedHistory(presentationJSON as any, auth);

  if (!signedResult.verified) {
    throw new Error("Notarization presentation was not verified by backend");
  }

  await ActionLogMessage(
    `Signed upload verified: ${signedResult.verified}, crafted: ${signedResult.crafted}, moved_to_storage: ${signedResult.moved_to_storage}`
  );

  await ActionAddNotarizedTradeupItems(signedResult.crafted);
  
  return {
    crafted: signedResult.crafted,
    notarized: true,
  };
}
