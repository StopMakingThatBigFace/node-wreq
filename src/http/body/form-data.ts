function getMediaType(contentType: string): string {
  const [mediaType = ''] = contentType.split(';', 1);

  return mediaType.trim().toLowerCase();
}

function getMultipartBoundary(contentType: string): string | null {
  for (const parameter of contentType.split(';').slice(1)) {
    const separatorIndex = parameter.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const name = parameter.slice(0, separatorIndex).trim().toLowerCase();

    if (name !== 'boundary') {
      continue;
    }

    let value = parameter.slice(separatorIndex + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    return value.length > 0 ? value : null;
  }

  return null;
}

export async function parseResponseFormData(
  bytes: Uint8Array,
  contentType: string
): Promise<FormData> {
  const mediaType = getMediaType(contentType);

  if (mediaType === 'application/x-www-form-urlencoded') {
    const formData = new FormData();
    const searchParams = new URLSearchParams(Buffer.from(bytes).toString('utf8'));

    for (const [name, value] of searchParams) {
      formData.append(name, value);
    }

    return formData;
  }

  if (mediaType !== 'multipart/form-data') {
    throw new TypeError(`Response content-type is not form data: ${contentType || 'unknown'}`);
  }

  if (!getMultipartBoundary(contentType)) {
    throw new TypeError('Missing or invalid multipart/form-data boundary in Content-Type header');
  }

  const NativeResponse = globalThis.Response;

  if (typeof NativeResponse !== 'function') {
    throw new TypeError('multipart/form-data parsing requires global Response support');
  }

  try {
    return await new NativeResponse(bytes, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch (error) {
    const wrapped = new TypeError('Failed to parse multipart/form-data response body');

    Object.defineProperty(wrapped, 'cause', {
      value: error,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    throw wrapped;
  }
}
