import { ConfidentialClientApplication } from '@azure/msal-node';

const msalConfig: any = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    authority: process.env.AZURE_AUTHORITY || 'https://login.microsoftonline.com/common',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  },
  system: {
    loggerOptions: {
      loggerCallback: (logLevel: any, message: any) => {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: 'Info',
    },
  },
};

// Lazy-init so server can start even without Azure credentials
let _msalApp: ConfidentialClientApplication | null = null;
export function getMsalApp(): ConfidentialClientApplication | null {
  if (!msalConfig.auth.clientId || !msalConfig.auth.clientSecret) return null;
  if (!_msalApp) {
    _msalApp = new ConfidentialClientApplication(msalConfig);
  }
  return _msalApp;
}

export const protectedResources = {
  graphApi: {
    scopes: ['https://graph.microsoft.com/.default'],
  },
};
