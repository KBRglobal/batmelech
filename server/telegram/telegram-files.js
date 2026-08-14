'use strict';

// Downloading an attachment from Telegram is two calls: getFile turns a
// file_id into a short-lived path, then a plain GET on the file host fetches
// the bytes. Raw fetch, no SDK — same convention as send-message.js.
//
// Both helpers swallow their own failures and return null. The webhook layer
// treats "no file" as "reply to Felix in Hebrew and move on", never as a crash
// on a request Telegram will retry.

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

async function getFilePath({ botToken, fileId, logger = console }) {
  if (typeof botToken !== 'string' || !botToken.trim()) {
    logger.error('getFilePath: missing bot token');
    return null;
  }
  if (typeof fileId !== 'string' || !fileId.trim()) {
    logger.error('getFilePath: missing file id');
    return null;
  }
  try {
    const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const response = await fetch(url);
    if (!response.ok) {
      logger.error('getFilePath: non-ok response', response.status);
      return null;
    }
    const payload = await response.json().catch(() => null);
    const path = payload && payload.result && typeof payload.result.file_path === 'string'
      ? payload.result.file_path.trim()
      : '';
    if (payload && payload.ok === false) {
      logger.error('getFilePath: api error', payload.description || '');
      return null;
    }
    return path === '' ? null : path;
  } catch (error) {
    logger.error('getFilePath failed', error);
    return null;
  }
}

// The size cap is checked twice on purpose: Content-Length is a claim the
// server makes and may be absent or wrong, so the decoded buffer is measured
// too before anything downstream sees it.
async function downloadFile({ botToken, filePath, maxBytes = DEFAULT_MAX_BYTES, logger = console }) {
  if (typeof botToken !== 'string' || !botToken.trim()) {
    logger.error('downloadFile: missing bot token');
    return null;
  }
  if (typeof filePath !== 'string' || !filePath.trim()) {
    logger.error('downloadFile: missing file path');
    return null;
  }
  try {
    const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath.trim()}`);
    if (!response.ok) {
      logger.error('downloadFile: non-ok response', response.status);
      return null;
    }
    const declared = Number(response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length')
      : null);
    if (Number.isFinite(declared) && declared > maxBytes) {
      logger.error('downloadFile: file too large', declared);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      logger.error('downloadFile: decoded file too large', buffer.byteLength);
      return null;
    }
    return buffer;
  } catch (error) {
    logger.error('downloadFile failed', error);
    return null;
  }
}

module.exports = { DEFAULT_MAX_BYTES, downloadFile, getFilePath };
