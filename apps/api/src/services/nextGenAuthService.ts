import { logger } from '../utils/logger';

/**
 * Validate NextGen credentials by attempting ASP.NET Forms Authentication.
 * Returns true if NextGen returns a 302 redirect with auth cookies, indicating
 * a successful login. This is a stateless validation; it does not persist cookies.
 */
export async function validateNextGenCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const baseUrl = process.env.NEXTGEN_API_URL || 'https://nextgen.madison88.com';

  try {
    // Step 1: GET /Account/Login to obtain anti-forgery token and initial cookies
    const getPage = await fetch(`${baseUrl}/Account/Login`);
    const html = await getPage.text();
    const pageCookies = getPage.headers.getSetCookie?.() || [];

    const tokenRegex = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/;
    const tokenRegex2 = /__RequestVerificationToken[\s\S]*?value="([^"]+)"/;
    let tokenMatch = html.match(tokenRegex);
    if (!tokenMatch) tokenMatch = html.match(tokenRegex2);

    if (!tokenMatch) {
      logger.error('NextGen auth: could not extract __RequestVerificationToken from login page');
      return false;
    }

    const antiForgeryToken = tokenMatch[1];
    const antiForgeryCookie = pageCookies.map((c: string) => c.split(';')[0]).join('; ');

    // Step 2: POST /Account/Login with credentials
    const loginBody = new URLSearchParams({
      '__RequestVerificationToken': antiForgeryToken,
      'Username': username,
      'Password': password,
    });

    const loginRes = await fetch(`${baseUrl}/Account/Login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': antiForgeryCookie,
      },
      body: loginBody.toString(),
      redirect: 'manual',
    });

    const success = loginRes.status === 302;
    if (!success) {
      logger.warn(`NextGen auth failed for ${username}: status ${loginRes.status}`);
    }
    return success;
  } catch (error) {
    logger.error('NextGen auth validation error:', error);
    return false;
  }
}
