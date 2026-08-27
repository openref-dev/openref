import type { DocumentSource, LoadedDocument } from '../../domain/loaded-document.types';
import { loadConfigDocument } from '../../infrastructure/adapters/config-document.adapter';
import { loadFromNestApplication } from '../../infrastructure/adapters/nest-application.adapter';
import { loadSpecDocument } from '../../infrastructure/adapters/spec-document.adapter';

/**
 * Loads a document from whichever source a command resolved: a spec file, a config file, or a
 * running application. One dispatch point, so a command never has to know which adapter answers.
 *
 * @throws {UsageError} When a file source cannot be read or parsed
 * @throws {NormalizeError} When a file source does not normalize as OpenAPI
 * @throws {ApplicationBootError} When `--from-nest` could not produce a document
 */
export async function loadDocument(source: DocumentSource): Promise<LoadedDocument> {
  switch (source.kind) {
    case 'spec':
      return loadSpecDocument(source.path);
    case 'config':
      return loadConfigDocument(source.path);
    case 'from-nest':
      return loadFromNestApplication(source.path);
  }
}
