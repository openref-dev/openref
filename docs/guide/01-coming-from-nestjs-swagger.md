## Coming from `@nestjs/swagger`

OPENREF does not replace `@nestjs/swagger`. It keeps building your OpenAPI document; OPENREF
renders it and adds what the running application knows.

Here is a normal setup today:

```ts
const app = await NestFactory.create(AppModule);

const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('Orders').setVersion('1.0.0').build(),
);

SwaggerModule.setup('docs', app, document);

await app.listen(3000);
```

Here is the same setup with OPENREF:

```ts
const app = await NestFactory.create(AppModule);

const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('Orders').setVersion('1.0.0').build(),
);

OpenRefModule.setup('/docs', app, { document });

await app.listen(3000);
```

One line changed. `createDocument` stays exactly where it was, and so does every
`@ApiProperty`, `@ApiResponse` and `@ApiTags` you have already written.

### What you gain on the first render

The change above touches the renderer and nothing else, so what you gain from it is what a
renderer can give you:

| You had | You now also have |
| --- | --- |
| A page that fetched its assets from a CDN | Assets served by your own application, digest named, with no outgoing request |
| A page that needed `unsafe-inline` | Markup with neither an inline style nor an inline script, so a policy without it accepts the page. You still send the header; this module never writes one |
| A console that sent from the page | A console that can send through your own origin, when you turn the proxy on |

Everything below this line is the part a renderer cannot do, and none of it arrives until you
register the collector that reads it.

### What you lose

Nothing that `@nestjs/swagger` produced. But be honest about <!-- gen: count:list -->two<!-- /gen --> things:

- **Swagger UI's "Authorize" dialog is not the same dialog.** OPENREF has its own console, with
  its own credential handling described in the security section. If your team has muscle memory
  for Swagger UI, that muscle memory does not transfer.
- **OPENREF renders OpenAPI 3.0 and later, and AsyncAPI 3 and later.** Swagger 2.0 documents and
  AsyncAPI 2.x documents are not accepted on the input side, and that is a stated non-goal
  rather than a missing feature.

### Running both at once

You can. They mount at different routes and neither knows about the other:

```ts
SwaggerModule.setup('swagger', app, document);
OpenRefModule.setup('/docs', app, { document });
```

This is the recommended way to try it. Point half your team at `/docs`, keep `/swagger` where
it was, and remove the second line when nobody opens it any more.

### The collectors that make it worth the move

Everything above is a nicer renderer, and a nicer renderer is not a reason to change a
dependency. This is, and it is a block in your root module rather than a line:

```ts
OpenRefModule.forRoot({
  runtime: {
    collectors: [guardsCollector(), scopesCollector({ metadataKey: SCOPES_KEY }), sourceCollector()],
    sourceLink: 'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
  },
});
```

That block, exactly as printed, adds <!-- gen: count:fence -->two<!-- /gen --> things:

<!-- gen: claims:printed-block -->
```
Guards and the scopes a route requires
A link to the line the handler is written on
```
<!-- /gen -->

The other facts a `@nestjs/swagger` setup never had cost more than a line each. Error
contracts, in three groups that are never one list, need `errorsCollector({ catalogs, global })`
and a catalogue you declare, because nothing derives an endpoint's errors from an exception
filter. Rate limits need `throttlerCollector()` from `@openref/collector-throttler`, a second
package, so that `@openref/nest` never puts a rate limiting library in the closure of an
application that does not rate limit anything.

With those in place the reference stops being a rendering of a file and starts being a report
about your application. A guard that protects a route the document says is public becomes a
finding with a rule code, not something a reader has to notice.
