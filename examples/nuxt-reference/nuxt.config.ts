/**
 * The SPEC 16.4 example, and every line of it is a decision a reader should be able to copy.
 *
 * TELEMETRY IS OFF, EXPLICITLY. SPEC 19.5 puts telemetry at zero for anything this project
 * publishes, and Nuxt's own is a setting of the host application rather than something the module
 * turns off behind a reader's back. Off here, where it can be seen.
 *
 * THE REFERENCE IS MOUNTED UNDER A PATH OF ITS OWN. The application keeps its root page, the
 * reference keeps `/docs`, and no file has two writers.
 */
export default defineNuxtConfig({
  telemetry: false,
  devtools: { enabled: false },
  modules: ['@openref/nuxt'],
  openref: {
    spec: './openapi.yaml',
    base: '/docs',
    target: 'nitro',
  },
});
