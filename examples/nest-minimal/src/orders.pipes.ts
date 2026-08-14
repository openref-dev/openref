import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

/**
 * The application side of the pipes fact: two real transforms at two scopes.
 *
 * `pipesCollector` reports class names and scopes, per SPEC 6.2.1, and the standing rule of
 * this example is that a collector registered here has something true to read. So both pipes
 * do real work: a route input arriving with stray whitespace is trimmed everywhere, and the
 * currency filter matches the ISO code however it was typed. What the reference will show is
 * `TrimPipe` at `route`, from `@UsePipes` on the controller, and `CurrencyPipe` at
 * `parameter`, from the one argument it stands on, which is exactly the same-fact-different-
 * scope distinction the guard rows already draw.
 */

/** Trims every string input of every route, declared once on the controller. */
@Injectable()
export class TrimPipe implements PipeTransform {
  /**
   * @param value - Whatever the binding delivered
   * @returns The trimmed string, or the value untouched when it is not a string
   */
  transform(value: unknown): unknown {
    return typeof value === 'string' ? value.trim() : value;
  }
}

/** Uppercases the currency filter, so `eur` matches the ISO 4217 code the orders carry. */
@Injectable()
export class CurrencyPipe implements PipeTransform {
  /**
   * @param value - The raw query value
   * @returns The uppercased code, or the value untouched when it is not a string
   */
  transform(value: unknown): unknown {
    return typeof value === 'string' ? value.toUpperCase() : value;
  }
}
