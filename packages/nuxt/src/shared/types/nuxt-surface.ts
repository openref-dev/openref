/**
 * The part of Nuxt and Nitro this module touches, declared here instead of imported.
 *
 * THE SAME MOVE `nest-surface.ts` MAKES, AND FOR THE SAME REASON. A module for Nuxt runs inside
 * somebody else's build, so the framework is the host's dependency rather than this package's:
 * importing `@nuxt/kit` for `defineNuxtModule` would put a resolver, a template engine and an
 * auto import scanner into the closure of a package that needs none of them, and would tie this
 * code to one minor of a kit whose helpers are sugar over the two hooks used below. A Nuxt module
 * is a function of `(options, nuxt)`, and that is all this file describes.
 *
 * STRUCTURAL AND MINIMAL, WHICH IS WHAT MAKES IT HONEST. Every member here is one this package
 * reads or writes; nothing is declared for completeness. A member Nuxt renames is a compile
 * failure in the example application, which is a real Nuxt build and is the only place that can
 * report it.
 */

/** One route Nitro answers, as `NitroConfig.handlers` holds it. */
export interface NitroHandlerEntry {
  /** Route pattern in Nitro's own dialect, where `/**` is the catch all. */
  readonly route: string;
  /** Absolute path of the module whose default export is the event handler. */
  readonly handler: string;
  /** HTTP method, lower case. Absent answers every method. */
  readonly method?: string;
}

/** One directory Nitro publishes as static files, as `NitroConfig.publicAssets` holds it. */
export interface NitroPublicAssetEntry {
  /** Absolute path of the directory. */
  readonly dir: string;
  /** Address its files answer at. */
  readonly baseURL: string;
  /** `max-age` in seconds for the files in it. */
  readonly maxAge: number;
}

/** The Nitro configuration, reduced to what this module reads and writes. */
export interface NitroConfigSurface {
  /**
   * Whether this build produces a static deployment rather than a server.
   *
   * MEASURED RATHER THAN GUESSED, on Nuxt 4.5.2: `nuxt generate` reaches this hook with `static`
   * true and `nuxt build` reaches it with the member absent. It is the discriminator the module
   * needs before Nitro has resolved a preset, and it arrives early enough to decide which half of
   * SPEC 16.4 runs.
   */
  readonly static?: boolean;
  /** Route handlers, appended to rather than replaced. */
  handlers?: NitroHandlerEntry[];
  /** Directories published as static files, appended to rather than replaced. */
  publicAssets?: NitroPublicAssetEntry[];
  /** What the prerenderer must not visit. */
  prerender?: {
    ignore?: (string | RegExp | ((path: string) => boolean))[];
    routes?: string[];
    crawlLinks?: boolean;
  };
}

/** A built Nitro instance, reduced to the one thing the generation half reads. */
export interface NitroSurface {
  readonly options: {
    readonly output: {
      /** Where the deployed public directory is assembled. */
      readonly publicDir: string;
    };
  };
}

/** The Nuxt instance, reduced to the two hooks and the options this module reads. */
export interface NuxtSurface {
  readonly options: {
    /** Inline options a host may put under `openref` in `nuxt.config`. */
    readonly openref?: unknown;
    /** The project root, which is what a relative `spec` path is relative to. */
    readonly rootDir: string;
    /** Where Nuxt keeps what it generates, `.nuxt` by default. */
    readonly buildDir: string;
  };
  /**
   * Registers a hook.
   *
   * TWO ARE USED AND THEY ARE THE TWO HALVES OF SPEC 16.4. `nitro:config` is where the routes
   * and the embedded document are declared, before Nitro builds anything; `nitro:build:public-assets`
   * is where the static build writes, into the directory the deployment ships.
   *
   * @param name - Hook name
   * @param handler - What runs
   */
  hook(name: 'nitro:config', handler: (config: NitroConfigSurface) => void): void;
  hook(
    name: 'nitro:build:public-assets',
    handler: (nitro: NitroSurface) => void | Promise<void>,
  ): void;
}

/** What Nuxt reads off a module function to report it. */
export interface NuxtModuleMeta {
  readonly name: string;
  readonly configKey: string;
}

/** A Nuxt module, which is a function with a `meta` on it. */
export interface NuxtModule<TOptions> {
  (inlineOptions: Partial<TOptions> | undefined, nuxt: NuxtSurface): void | Promise<void>;
  meta: NuxtModuleMeta;
}
