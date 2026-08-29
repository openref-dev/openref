import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventPattern, Transport } from '@nestjs/microservices';
import { OpenRefModule } from '../../src/api/openref.module';
import { MountedReferences } from '../../src/api/mounted-references';
import { ApiChannel, ApiPublishes } from '../../src/api/decorators/api-decorators';
import { OPENREF_REFERENCES } from '../../src/shared/constants/tokens';
import { assetPlan } from '../mocks/fixtures';

/**
 * The topology of SPEC 9, built from a booted application rather than from a fake container.
 *
 * WHAT ONLY THIS FILE CAN PROVE. The unit suite calls `runRuntimePass` directly and hands it the
 * confidence map, so it proves the correction and not the wiring. The map is built in
 * `pairChannels` and carried through `MountedReferences.collect`, and the only thing that shows
 * those two agree is a document that came out of `onModuleInit`.
 *
 * THE PAIR OF CHANNELS IS THE CASE. Both handlers are `@EventPattern` and both receive; the only
 * difference is that one of them says so with `@ApiChannel({ direction })`. If the correction were
 * absent, both would read `declared`, because both travelled through a document this package
 * wrote, and the difference between the two is the whole of SPEC 6.1 in one assertion.
 */

@Controller()
class DefaultedController {
  @EventPattern('orders.created', Transport.KAFKA)
  created(): void {
    // nothing
  }
}

@Controller()
class DeclaredController {
  @ApiChannel({ direction: 'receive' })
  @ApiPublishes('orders.archived')
  @EventPattern('orders.settled', Transport.KAFKA)
  settled(): void {
    // nothing
  }
}

@Module({
  controllers: [DefaultedController, DeclaredController],
  imports: [
    OpenRefModule.forRoot({
      documents: [
        {
          id: 'events',
          route: '/docs/events',
          kind: 'events',
          title: 'Orders events',
          assetPlan: assetPlan(),
          servers: [{ protocol: 'kafka', host: 'kafka.example.com:9092' }],
        },
      ],
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class TopologyModule {}

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

function references(): MountedReferences {
  const resolved = running?.get(OPENREF_REFERENCES, { strict: false });
  if (!(resolved instanceof MountedReferences)) throw new Error('forRoot registered no provider');

  return resolved;
}

describe('the topology of a booted application, per SPEC 9', () => {
  it('should carry each edge at the confidence its direction was actually read at', async () => {
    // Given an application whose two handlers differ only in whether a person wrote the direction
    running = await NestFactory.create(TopologyModule as never, {
      logger: false,
      abortOnError: false,
    });
    await running.listen(0, '127.0.0.1');

    // When
    const document = references().get('events')?.service.document;

    // Then, with both channels asserted present first, so the edges below are a reading of two
    // channels rather than a list that happens to have two entries
    expect([...(document?.nodes.keys() ?? [])].sort()).toEqual([
      'channel-orders-created',
      'channel-orders-settled',
    ]);
    expect(document?.relationships).toEqual([
      {
        from: 'channel-orders-created',
        fromKind: 'node',
        to: 'orders-events',
        toKind: 'service',
        type: 'subscribes',
        confidence: 'derived',
      },
      {
        from: 'channel-orders-settled',
        fromKind: 'node',
        to: 'orders.archived',
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
      {
        from: 'channel-orders-settled',
        fromKind: 'node',
        to: 'orders-events',
        toKind: 'service',
        type: 'subscribes',
        confidence: 'declared',
      },
    ]);
  });
});
