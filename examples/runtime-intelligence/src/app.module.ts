import { Module } from '@nestjs/common';
import {
  declarationsCollector,
  guardsCollector,
  OpenRefModule,
  sourceCollector,
} from '@openref/nest';
import { abilityCollector } from './ability.collector.js';
import { ABILITY_KEY, InventoryController } from './inventory.controller.js';

/**
 * Four collectors, and one of them was written in this directory.
 *
 * `forRoot` CONTRIBUTES THE CONTAINER AND NOTHING ELSE HERE. The document comes from
 * `SwaggerModule.createDocument(app, ...)`, which needs the application and therefore does not
 * exist when this array is read. What this registration buys is the injection point for
 * `DiscoveryService`, which is the only public route to the controller classes every runtime
 * fact hangs off.
 */
@Module({
  controllers: [InventoryController],
  imports: [
    OpenRefModule.forRoot({
      runtime: {
        collectors: [
          sourceCollector(),
          guardsCollector(),
          declarationsCollector(),
          abilityCollector({ metadataKey: ABILITY_KEY }),
        ],
        sourceLink: 'https://github.com/sur-ser/openref/blob/{ref}/{file}#L{line}',
      },
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
