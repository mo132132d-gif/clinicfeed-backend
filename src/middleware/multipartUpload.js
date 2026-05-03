const { createHttpError } = require('../utils/httpError');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg'
]);

const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg']);

const supplierImportMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  // Browser default when the part omits Content-Type — common for uploads from Explorer / older clients
  'application/octet-stream'
]);

const supplierImportExtensions = new Set(['xlsx', 'csv']);

function sanitizeFileName(fileName) {
  return String(fileName || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-\u0600-\u06FF]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'file';
}

function extensionFromName(fileName) {
  const parts = String(fileName || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of String(value || '').split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawValue.length) {
      continue;
    }

    result[rawKey] = rawValue.join('=').replace(/^"|"$/g, '');
  }

  return result;
}

function splitMultipart(buffer, boundary) {
  const body = buffer.toString('binary');
  const delimiter = `--${boundary}`;
  return body
    .split(delimiter)
    .slice(1, -1)
    .map((part) => Buffer.from(part.replace(/^\r\n/, '').replace(/\r\n$/, ''), 'binary'));
}

function parsePart(part) {
  const separator = Buffer.from('\r\n\r\n');
  const separatorIndex = part.indexOf(separator);
  if (separatorIndex === -1) {
    return null;
  }

  const rawHeaders = part.slice(0, separatorIndex).toString('utf8');
  const body = part.slice(separatorIndex + separator.length);
  const headers = {};

  for (const line of rawHeaders.split('\r\n')) {
    const [rawKey, ...rawValue] = line.split(':');
    if (!rawValue.length) {
      continue;
    }

    headers[rawKey.trim().toLowerCase()] = rawValue.join(':').trim();
  }

  const disposition = parseContentDisposition(headers['content-disposition']);
  return {
    name: disposition.name,
    filename: disposition.filename,
    contentType: headers['content-type'] || 'application/octet-stream',
    body
  };
}

function validateFile(file, options = {}) {
  const mimeTypes = options.allowedMimeTypes || allowedMimeTypes;
  const extensions = options.allowedExtensions || allowedExtensions;

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw createHttpError(400, 'File is required');
  }

  if (file.buffer.length > MAX_FILE_SIZE) {
    throw createHttpError(400, 'File size exceeds 10MB');
  }

  const extension = extensionFromName(file.originalName);
  if (!extensions.has(extension) || !mimeTypes.has(file.mimeType)) {
    throw createHttpError(400, 'Unsupported file type');
  }
}

function createMultipartUpload(options = {}) {
  return function multipartUpload(req, res, next) {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

    if (!boundaryMatch) {
      next(createHttpError(400, 'Expected multipart/form-data request'));
      return;
    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE + 1024 * 256) {
        req.destroy(createHttpError(400, 'File size exceeds 10MB'));
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fields = {};
        let file = null;

        for (const rawPart of splitMultipart(buffer, boundary)) {
          const part = parsePart(rawPart);
          if (!part || !part.name) {
            continue;
          }

          if (part.filename !== undefined) {
            file = {
              fieldName: part.name,
              originalName: sanitizeFileName(part.filename),
              mimeType: part.contentType,
              size: part.body.length,
              buffer: part.body
            };
          } else {
            fields[part.name] = part.body.toString('utf8');
          }
        }

        validateFile(file, options);
        req.body = fields;
        req.file = file;
        next();
      } catch (error) {
        next(error);
      }
    });

    req.on('error', next);
  };
}

const multipartUpload = createMultipartUpload();
const supplierImportUpload = createMultipartUpload({
  allowedMimeTypes: supplierImportMimeTypes,
  allowedExtensions: supplierImportExtensions
});

module.exports = {
  MAX_FILE_SIZE,
  allowedMimeTypes,
  allowedExtensions,
  createMultipartUpload,
  multipartUpload,
  supplierImportUpload,
  sanitizeFileName
};
