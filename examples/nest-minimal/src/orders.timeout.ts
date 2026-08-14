import { GatewayTimeoutException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwError, TimeoutError, timeout } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type {
  CallHandler,
  CustomDecorator,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * The application side of the timeout fact: a key, the decorator that writes it, and the
 * interceptor that enforces it.
 *
 * IT IS THE APPLICATION'S KEY, the `SCOPES_KEY` shape again: SPEC 6.1 forbids guessing one, so
 * `timeoutCollector({ metadataKey: TIMEOUT_KEY })` in `app.module.ts` is handed this one. What
 * the reference will show is the number at `derived`, because the number is metadata under a
 * known key; what it will never show is anything read out of the interceptor's code, because
 * interceptor logic is never read, on the same grounds guard logic is never read. The
 * interceptor below reads the same key the collector reads, so the reported number is the
 * enforced number rather than an approximation of it.
 */

/** The key this application writes its route timeouts under. Milliseconds. */
export const TIMEOUT_KEY = 'openref.example.timeout';

/**
 * Declares the timeout a route is served under.
 *
 * @param ms - The budget, in milliseconds
 * @returns The decorator, which writes the number under {@link TIMEOUT_KEY}
 */
export function RouteTimeout(ms: number): CustomDecorator {
  return SetMetadata(TIMEOUT_KEY, ms);
}

/**
 * Ends a request that outlives its declared budget with the 504 a gateway would send.
 *
 * A METHOD'S TIMEOUT REPLACES A CLASS'S, which is why this is `getAllAndOverride`: a route
 * that overrides its budget has that budget. The same read, in the same order, is what
 * `timeoutCollector` performs, so the reference and the enforcement cannot disagree.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  /**
   * @param context - The execution context NestJS hands every interceptor
   * @param next - The handler chain
   * @returns The handler's stream, raced against the declared budget
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ms = this.reflector.getAllAndOverride<number | undefined>(TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (ms === undefined) return next.handle();

    return next.handle().pipe(
      timeout(ms),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof TimeoutError ? new GatewayTimeoutException() : (error as Error),
        ),
      ),
    );
  }
}
