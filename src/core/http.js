import { AppError, ErrorCode } from './errors.js';
import { maskSecrets } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(err) {
  if (err.code === ErrorCode.TIMEOUT || err.code === ErrorCode.NETWORK) return true;
  if (err.code === ErrorCode.BAD_RESPONSE) return true;
  if (err.code === ErrorCode.HTTP) return err.details.status >= 500;
  return false;
}

async function fetchJsonOnce(url, { timeoutMs, signal, doFetch, headers }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }
  const safeUrl = maskSecrets(url);

  try {
    const res = await doFetch(url, headers ? { signal: controller.signal, headers } : { signal: controller.signal });
    if (!res.ok) {
      throw new AppError(ErrorCode.HTTP, `HTTP ${res.status}`, {
        details: { status: res.status, url: safeUrl },
      });
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (cause) {
      // Some panels answer with an HTML page when they rate-limit or reject a request.
      throw new AppError(ErrorCode.BAD_RESPONSE, 'Response is not valid JSON', {
        cause,
        details: { url: safeUrl },
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (timedOut) throw new AppError(ErrorCode.TIMEOUT, 'Request timed out', { cause: err });
    if (signal && signal.aborted) throw new AppError(ErrorCode.ABORTED, 'Request aborted', { cause: err });
    throw new AppError(ErrorCode.NETWORK, 'Network error', { cause: err, details: { url: safeUrl } });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** fetch + timeout + abort + retry/backoff, always rejecting with an AppError. */
export async function fetchJson(
  url,
  { timeoutMs = 15000, retries = 1, retryDelayMs = 500, signal, fetchImpl, headers } = {},
) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchJsonOnce(url, { timeoutMs, signal, doFetch, headers });
    } catch (err) {
      const canRetry = isRetryable(err) && attempt < retries && !(signal && signal.aborted);
      if (!canRetry) throw err;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
}
