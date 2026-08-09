import { ErrorCode, ThemeContractError } from '@openref/core';
import { inject, provide } from 'vue';
import type { InjectionKey } from 'vue';
import type { DocState } from '../domain/doc-state';

/**
 * How the document state reaches a component: `provide` and `inject`, per SPEC 11.
 *
 * There is no module level store here on purpose. Two references mounted on one page, which
 * federation makes ordinary, would share a module singleton and would not share a provided
 * one. The injection key is a `Symbol`, so nothing collides with a host application either.
 */

/** Key the state is provided under. */
export const DOC_STATE_KEY: InjectionKey<DocState> = Symbol('openref.docState');

/**
 * Makes a state available to everything below this component.
 *
 * @param state - State built by `createDocState`
 *
 * @example
 * setup() { provideDocState(createDocState({ document })); }
 */
export function provideDocState(state: DocState): void {
  provide(DOC_STATE_KEY, state);
}

/**
 * The state provided above this component.
 *
 * @returns The state
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const state = useDocState();
 */
export function useDocState(): DocState {
  const state = inject(DOC_STATE_KEY, undefined);
  if (state === undefined) {
    throw new ThemeContractError(
      'no OPENREF document state was provided above this component; call provideDocState in an ancestor',
      ErrorCode.THEME_CONTRACT_VIOLATED,
    );
  }
  return state;
}
