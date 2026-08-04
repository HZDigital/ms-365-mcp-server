import { ConfidentialClientApplication } from '@azure/msal-node';
import logger from './logger.js';
import type { AppSecrets } from './secrets.js';
import { getCloudEndpoints } from './cloud-config.js';
import type { DynamicsConfig } from './dynamics-config.js';
import type { DownstreamResource } from './request-context.js';

class OboClient {
  private cca: ConfidentialClientApplication;
  private readonly scopes: Record<DownstreamResource, string | undefined>;

  constructor(secrets: AppSecrets, dynamics?: DynamicsConfig) {
    if (!secrets.clientSecret) {
      throw new Error(
        'On-Behalf-Of flow requires MS365_MCP_CLIENT_SECRET to be set (confidential client).'
      );
    }

    const cloudEndpoints = getCloudEndpoints(secrets.cloudType);

    this.cca = new ConfidentialClientApplication({
      auth: {
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        authority: `${cloudEndpoints.authority}/${secrets.tenantId || 'common'}`,
      },
    });

    const graphBase = cloudEndpoints.graphApi.replace(/\/$/, '');
    this.scopes = { graph: `${graphBase}/.default`, dynamics: dynamics?.scope };
  }

  async exchangeToken(
    userAssertion: string,
    resource: DownstreamResource = 'graph'
  ): Promise<string> {
    const scope = this.scopes[resource];
    if (!scope) {
      throw new Error(`OBO token exchange requested for unconfigured resource: ${resource}`);
    }
    try {
      const result = await this.cca.acquireTokenOnBehalfOf({
        oboAssertion: userAssertion,
        scopes: [scope],
      });

      if (!result?.accessToken) {
        throw new Error('OBO token exchange returned no access token');
      }

      logger.info(`OBO token exchange successful for ${resource}`);
      return result.accessToken;
    } catch (error) {
      logger.error(`OBO token exchange failed for ${resource}: ${(error as Error).message}`);
      throw error;
    }
  }
}

export default OboClient;
