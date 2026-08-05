import { Handler } from '@netlify/functions';

const VPS_URL = 'http://5.223.78.194';

/**
 * Proxy for slow API endpoints that exceed Netlify's 10-second redirect timeout.
 * Supports up to 300 seconds (Netlify Function limit).
 *
 * Routes:
 *   /.netlify/functions/proxy-api/invoices/:id/post  → /api/invoices/:id/post
 *   Any path after proxy-api/ is forwarded to /api/ on the VPS
 */
export const handler: Handler = async (event) => {
  const authHeader = event.headers.authorization || '';
  const contentType = event.headers['content-type'] || '';
  const method = event.httpMethod;

  // Extract the API path after /proxy-api/
  const fnName = 'proxy-api';
  const pathPrefix = `/.netlify/functions/${fnName}`;
  let apiPath = event.path.replace(pathPrefix, '');

  // If empty, try from rawUrl or resource
  if (!apiPath || apiPath === '/') {
    apiPath = (event.rawUrl || '').split(fnName)[1] || '';
  }

  // Ensure it starts with /api/
  if (!apiPath.startsWith('/api/')) {
    apiPath = '/api' + (apiPath.startsWith('/') ? apiPath : '/' + apiPath);
  }

  // Append query string
  const queryString = event.rawQuery ? '?' + event.rawQuery : '';

  try {
    const headers: Record<string, string> = {
      'Authorization': authHeader,
    };
    if (contentType) headers['Content-Type'] = contentType;

    const response = await fetch(`${VPS_URL}${apiPath}${queryString}`, {
      method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? event.body : undefined,
      signal: AbortSignal.timeout(290000), // 290 seconds (just under 300s limit)
    });

    const data = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
      body: data,
    };
  } catch (error: any) {
    return {
      statusCode: 504,
      body: JSON.stringify({ error: { message: error.message || 'API proxy timeout', status: 504 } }),
    };
  }
};
