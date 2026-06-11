import { ConfidentialClientApplication, ConfidentialClientApplicationConfig } from '@azure/msal-node';

const msalConfig: ConfidentialClientApplicationConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    authority: process.env.AZURE_AUTHORITY || 'https://login.microsoftonline.com/common',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  },
  system: {
    loggerOptions: {
      loggerCallback: (logLevel, message) => {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: 'Info',
    },
  },
};

export const msalApp = new ConfidentialClientApplication(msalConfig);

export const protectedResources = {
  graphApi: {
    scopes: ['https://graph.microsoft.com/.default'],
  },
};
