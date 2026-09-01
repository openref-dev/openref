import { Controller, Get, Param, Post, SetMetadata, UseGuards } from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiScopes } from '@openref/nest';

/** The metadata key this application writes its authorization rules under. */
export const ABILITY_KEY = 'inventory:ability';

/**
 * How this application declares what a route is allowed to do.
 *
 * A key of the application's own, because SPEC 6.1 refuses to guess one and there is
 * deliberately no default: reading a key nobody named would report somebody else's metadata as
 * this route's facts.
 */
export const Can = (...rules: readonly { action: string; subject: string }[]): MethodDecorator =>
  SetMetadata(ABILITY_KEY, rules);

/**
 * A guard whose decision is code, which is exactly why the reference never reports it.
 *
 * The name reaches the page. What it checks does not, at any confidence level, because a guard
 * is a function and a function is not readable as data.
 */
export class AbilityGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/** One item, kept small so the example is about the collector rather than about the schema. */
export class ItemDto {
  sku!: string;
  onHand!: number;
}

/**
 * Three routes, chosen so the three states of a fact are all visible on one page.
 *
 * `list` has rules and a guard: the collector reads scopes at `derived`.
 * `reserve` declares its scope outright: `@ApiScopes` is `declared`, and the page draws that
 * differently, because somebody wrote it rather than something read it.
 * `read` has a guard and no rules at all: the reference reports the absence rather than
 * drawing a blank, since a route that needs no scopes and a route whose scopes are unreadable
 * are different facts and a blank cannot tell them apart.
 */
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  @Get()
  @Can({ action: 'read', subject: 'inventory' }, { action: 'list', subject: 'inventory' })
  @UseGuards(AbilityGuard)
  @ApiOkResponse({ type: ItemDto, isArray: true })
  list(): ItemDto[] {
    return [{ sku: 'sku_1024', onHand: 3 }];
  }

  @Post('reserve')
  @ApiScopes('inventory:write')
  @UseGuards(AbilityGuard)
  @ApiOkResponse({ type: ItemDto })
  reserve(): ItemDto {
    return { sku: 'sku_1024', onHand: 2 };
  }

  @Get(':sku')
  @UseGuards(AbilityGuard)
  @ApiOkResponse({ type: ItemDto })
  read(@Param('sku') sku: string): ItemDto {
    return { sku, onHand: 3 };
  }
}
