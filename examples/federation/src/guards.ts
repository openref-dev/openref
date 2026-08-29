import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Three guards for three services, each enforcing a different scheme.
 *
 * THE CREDENTIALS ARE CONSTANTS AND THE DEMO SAYS SO ON STDOUT. The point of the demo is the
 * federated console: one page, one credential session, and a request that only succeeds when
 * the reader signed in to the right service. A guard that accepted anything would make the
 * isolation test in `@openref/nest` unprovable against this application.
 */

/** What each service accepts, printed by `serve.ts` so a reader can try them. */
export const DEMO_CREDENTIALS = {
  billingApiKey: 'demo-key',
  ordersBearer: 'demo-token',
  paymentsUser: 'demo',
  paymentsPassword: 'demo',
} as const;

interface HeaderCarrier {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

function headerOf(context: ExecutionContext, name: string): string {
  const request = context.switchToHttp().getRequest<HeaderCarrier>();
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

/** Billing: an api key in `X-Api-Key`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (headerOf(context, 'x-api-key') !== DEMO_CREDENTIALS.billingApiKey) {
      throw new UnauthorizedException('the X-Api-Key header is missing or wrong');
    }
    return true;
  }
}

/** Orders: a bearer token. */
@Injectable()
export class BearerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (headerOf(context, 'authorization') !== `Bearer ${DEMO_CREDENTIALS.ordersBearer}`) {
      throw new UnauthorizedException('the bearer token is missing or wrong');
    }
    return true;
  }
}

/** Payments: HTTP basic. */
@Injectable()
export class BasicGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const pair = `${DEMO_CREDENTIALS.paymentsUser}:${DEMO_CREDENTIALS.paymentsPassword}`;
    const expected = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
    if (headerOf(context, 'authorization') !== expected) {
      throw new UnauthorizedException('the basic credentials are missing or wrong');
    }
    return true;
  }
}
