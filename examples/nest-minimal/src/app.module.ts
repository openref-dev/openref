import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  declarationsCollector,
  errorsCollector,
  guardsCollector,
  handlerScanCollector,
  headersCollector,
  httpCodeCollector,
  OpenRefModule,
  pipesCollector,
  scopesCollector,
  sourceCollector,
  streamCollector,
  timeoutCollector,
} from '@openref/nest';
import { throttlerCollector } from '@openref/collector-throttler';
import { OrdersController } from './orders.controller.js';
import { ORDER_ERRORS } from './orders.errors.js';
import { REQUIRED_HEADERS_KEY } from './orders.headers.js';
import { SCOPES_KEY } from './orders.security.js';
import { TIMEOUT_KEY } from './orders.timeout.js';

/**
 * The whole application: one controller, and the runtime intelligence of SPEC 6.
 *
 * `forRoot` MOUNTS NOTHING HERE, AND THAT IS THE ORDINARY SHAPE RATHER THAN A CURIOSITY. The
 * document comes from `SwaggerModule.createDocument(app, ...)`, which needs the application, so
 * it does not exist until after `NestFactory.create` has returned, which is after this array is
 * read. What `forRoot` contributes is the container: it is the only place `DiscoveryService` can
 * be injected, and that is the only public route to the controller classes every runtime fact
 * hangs off. `main.ts` then calls `setup` with the document, and the pass is picked up from here.
 *
 * THE SOURCE LINK POINTS AT THIS REPOSITORY, which is what makes the demo demonstrate anything.
 * `sourceCollector` asks V8 where each handler is written and puts the file and the line in the
 * IR; the template turns them into a link. `tsconfig.json` sets `sourceMap: true` for the same
 * reason: without it the answer would be a line in `dist/`, and a link into a build directory is
 * the difference between the feature working and appearing to work.
 *
 * The revision is read from git. A build with no `.git` passes it instead, as
 * `sourceLink: { template, ref }`.
 *
 * TWELVE COLLECTORS, AND EACH ONE HAS SOMETHING IN THIS APPLICATION TO READ. That is the whole
 * reason the guard, the scope key, the throttled route, the pipes, the timeout pair, the token
 * guarded receipt and the explicit @HttpCode exist in `orders.controller.ts`: a collector
 * registered against an application with nothing for it to find reports nothing, and reporting
 * nothing is indistinguishable from working. The three that read a host key are given this
 * application's keys, because SPEC 6.1 forbids guessing one and there is deliberately no
 * default. The handler scan needs no material added at all: the five query parameters and the
 * header that `list` declares and never reads are real drift this application already had, and
 * SP010 reporting them is the product working rather than a fixture arranged to fail.
 *
 * `throttlerCollector` COMES FROM ITS OWN PACKAGE, per SPEC 4 and 6.2.1. A collector that reads a
 * third party library is published separately so that installing `@openref/nest` never puts a
 * throttler in the closure of an application that does not rate limit anything.
 *
 * An empty class is how NestJS declares a module. There is no other spelling.
 */
@Module({
  controllers: [OrdersController],
  imports: [
    // The store behind `@Throttle`. Without it `ThrottlerGuard` has no options to enforce, so the
    // rate limit the reference reports would be a number nothing acts on.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    OpenRefModule.forRoot({
      runtime: {
        collectors: [
          sourceCollector(),
          guardsCollector(),
          // The `declared` level of SPEC 6.1, which is what `@ApiScopes` writes, and the four
          // level priority of SPEC 13.6. Both read keys this package defines, so neither takes a
          // metadata key: there is nothing about them for an application to name.
          declarationsCollector(),
          streamCollector(),
          scopesCollector({ metadataKey: SCOPES_KEY }),
          throttlerCollector(),
          // SPEC 6.4. The catalog is this application's, for the reason `orders.errors.ts` gives,
          // and `global` is what the host says every endpoint can answer with. Nothing observes a
          // global exception filter to get that list: a filter says how an error is rendered if
          // one reaches the top, not that any endpoint produces one, so the honest source of an
          // application wide contract is the application saying so.
          errorsCollector({
            catalogs: [ORDER_ERRORS],
            global: [
              {
                status: 500,
                title: 'Internal Server Error',
                type: 'https://example.com/errors/internal',
              },
            ],
          }),
          // The TX-COLLECTORS five, the instruments behind the four parity rows that shipped
          // hatched plus the explicit success code. Appended, because appending to this list
          // cannot change a fact that already existed, per SPEC 6.2.
          pipesCollector(),
          timeoutCollector({ metadataKey: TIMEOUT_KEY }),
          headersCollector({ metadataKey: REQUIRED_HEADERS_KEY }),
          handlerScanCollector(),
          httpCodeCollector(),
        ],
        sourceLink: 'https://github.com/sur-ser/openref/blob/{ref}/{file}#L{line}',
      },
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
