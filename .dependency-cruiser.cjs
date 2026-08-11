/**
 * The dependency graph configuration dependency-cruiser reads.
 *
 * The rules themselves are in `tools/dependency-rules.cjs`, which builds them for a repository
 * root rather than for this one. That is not indirection for its own sake: the failure this whole
 * arrangement exists about is a ninth package appearing under `packages/`, and the only honest way
 * to check what happens then is to build the committed rules over a tree that has one. Planting a
 * ninth package into the real `packages/` breaks every test that cruises the repository in
 * parallel, which is how the first attempt was found.
 *
 * Nothing here is ever relaxed to make a build pass.
 */

module.exports = require('./tools/dependency-rules.cjs').buildConfig(__dirname);
