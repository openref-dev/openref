import 'reflect-metadata';
import { createServer } from 'node:net';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  declarationsCollector,
  guardsCollector,
  handlerScanCollector,
  httpCodeCollector,
  OpenRefModule,
} from '@openref/nest';
import type { INestApplication, Type } from '@nestjs/common';
import { BillingController, billingSpecification } from './billing.js';
import {
  ordersSpecification,
  paymentsSpecification,
  RemoteServicesModule,
} from './remote-services.js';

/**
 * The SPEC 15 three service demo: several services read as one reference.
 *
 * TWO APPLICATIONS IN ONE PROCESS, AND THE SPLIT IS THE POINT. The services application hosts
 * `orders` and `payments`, each serving its own reference, which is where their specifications
 * are fetched from over real HTTP: they are remotes, per SPEC 15.2. The gateway hosts `billing`
 * itself, so billing joins the federation as a local service, per SPEC 15.3, with the runtime
 * facts and the drift only a living process can have. One page at `/docs` reads all three: one
 * navigation, one search, one credential session, three auth schemes.
 */

/** Everything the demo booted, so a caller can stop it. */
export interface DemoApps {
  readonly gateway: INestApplication;
  readonly services: INestApplication;
  readonly gatewayUrl: string;
  readonly servicesUrl: string;
}

/**
 * The gateway module, built once the remote origins are known.
 *
 * A FACTORY BECAUSE `forRoot` READS ITS OPTIONS WHEN THE MODULE IS DEFINED, and the remote urls
 * carry the port the services application was given by the operating system. Everything else
 * about the module is the ordinary SPEC 13.2 shape.
 */
function gatewayModule(servicesOrigin: string): Type {
  @Module({
    controllers: [BillingController],
    imports: [
      OpenRefModule.forRoot({
        documents: [{ id: 'billing', route: '/billing-docs', document: billingSpecification() }],
        runtime: {
          collectors: [
            guardsCollector(),
            declarationsCollector(),
            handlerScanCollector(),
            httpCodeCollector(),
          ],
          // Which scheme the guard stands for, per SPEC 13.2, so security-drift can say that
          // `createCharge` is guarded while the document is silent.
          guardSecuritySchemes: { ApiKeyGuard: 'apiKey' },
        },
        federation: {
          route: '/docs',
          id: 'demo-gateway',
          title: 'Platform reference',
          description: 'Three services, one page: billing local, orders and payments remote.',
          services: [{ id: 'billing' }],
          remotes: [
            { id: 'orders', url: `${servicesOrigin}/orders-docs/openapi.json` },
            { id: 'payments', url: `${servicesOrigin}/payments-docs/openapi.json` },
          ],
          refreshMs: 5_000,
          // THE SPEC 14.5 PROXY STAYS OFF, AND THE REASON IS ITS OWN DEFENCE: the demo's
          // remotes live on loopback, and the SSRF policy refuses loopback upstreams fail
          // closed, which is correct and not something a demo works around. The services
          // application answers CORS instead, so the console sends to each service directly,
          // the way a browser reaches any API that allows it.
        },
      }),
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class GatewayModule {}

  return GatewayModule;
}

/**
 * A port the operating system considers free right now.
 *
 * ASKED FOR BEFORE THE APPLICATION EXISTS, because the services' specifications carry their own
 * origin in `servers` and the references must be mounted before `listen`: Express matches
 * routes in registration order, so a reference mounted after the not found handler answers 404.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * Boots both applications and mounts every reference.
 *
 * @param gatewayPort - Port for the gateway, 0 for any free one
 * @returns Both applications, listening
 */
export async function createDemo(gatewayPort = 4100): Promise<DemoApps> {
  // The services application first: its origin goes into its own specifications and into the
  // gateway's remote urls, so the port is chosen before anything is created.
  const servicesPort = await freePort();
  const servicesUrl = `http://127.0.0.1:${String(servicesPort)}`;
  const services = await NestFactory.create(RemoteServicesModule, {
    logger: false,
    abortOnError: false,
  });
  // The services own the CORS decision, the way any API that expects browser callers does:
  // the federated console sends to each service directly, credential header and all.
  services.enableCors({ origin: true, allowedHeaders: ['authorization', 'content-type'] });

  // Each remote serves its own reference; the gateway fetches the `openapi.json` these mounts
  // answer, which is the SPEC 15 shape: a remote is an address, not an import.
  OpenRefModule.setup('/orders-docs', services, { document: ordersSpecification(servicesUrl) });
  OpenRefModule.setup('/payments-docs', services, {
    document: paymentsSpecification(servicesUrl),
  });
  await services.listen(servicesPort, '127.0.0.1');

  const gateway = await NestFactory.create(gatewayModule(servicesUrl), {
    logger: false,
    abortOnError: false,
  });
  gateway.enableShutdownHooks();
  await gateway.listen(gatewayPort, '127.0.0.1');
  const gatewayUrl = await gateway.getUrl();

  return { gateway, services, gatewayUrl, servicesUrl };
}
