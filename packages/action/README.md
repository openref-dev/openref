# OPENREF API review action

Runs `openref pr` on a pull request: it diffs the working tree against the base ref, builds the
deterministic static preview when asked, and posts the SPEC 17.2 comment, updating the one it
posted before rather than adding another.

The action is a single composite step. Everything it does lives in `openref pr`, in the CLI, so
it is covered by that package's tests, versioned with that package's release, and runnable by
hand. What is here is the definition, its tests, and this page.

## What it needs

`openref` installed in the repository being reviewed. The action runs the binary that repository
already pinned and downloads nothing.

## Permissions

`pull-requests: write` for the comment, `contents: read` for the checkout. Nothing else. The
checkout has to reach the base ref, so `fetch-depth: 0` or an explicit fetch of the base branch
is required: a shallow clone has no object for `git show` to read.

On a pull request from a fork the token is read only. The action does not attempt the request; it
prints the comment, writes it to the job summary, and exits 0. `pull_request_target` is refused
outright, because that event issues a write scoped token while the head belongs to somebody else.

A fork status the run cannot establish is refused rather than assumed: when `GITHUB_EVENT_PATH` is
set and its payload cannot be read, the step exits 2 instead of posting.

## Which comment gets updated

Only one the API says this token wrote, because a marker is a line anybody can type and the
previous rule let a contributor's comment be adopted and overwritten.

There are two paths, one per kind of token. A user token or a personal access token is named by
`GET /user`, and a candidate is adopted when its author's login matches. `${{ github.token }}` is a
GitHub App installation token, which GitHub refuses that endpoint for; the refusal is what
identifies it, and a candidate is then adopted when GitHub itself marked the comment as written by
that app, `user.type` of `Bot` together with a `performed_via_github_app` slug of `github-actions`.
Neither field is part of a comment body, so no commenter can write them.

Anything else, another failure of the identity request, a missing field, or another app's slug,
leaves the identity unestablished: the run posts a new comment and says so on stderr rather than
overwriting one it cannot prove is its own.

## Usage

```yaml
name: API review
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: openref-dev/openref/packages/action@v1
        with:
          spec: openapi.json
          out: dist-docs
          preview-base: https://docs.example.com/previews
          fail-on-breaking: 'true'
```

## Inputs

| Input               | Default                     | What it does                                                                                                                  |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `spec`              | required                    | The OpenAPI document, read at the base ref and in the working tree                                                            |
| `base`              | the event's base            | The ref to compare against                                                                                                    |
| `out`               | none                        | Build the preview into this directory; empty means no build                                                                   |
| `preview-base`      | none                        | Where previews are published; `pr-<number>` is appended, and the result is both the build base and the address in the comment |
| `preview-url`       | none                        | An address somebody else already knows, printed as given                                                                      |
| `fail-on-breaking`  | `false`                     | Exit 1 on a breaking diff. Off, so the first run reports                                                                      |
| `dry-run`           | `false`                     | Print the comment instead of posting it                                                                                       |
| `repository`        | the workflow's              | The `owner/name` to comment on                                                                                                |
| `pull-request`      | the event's                 | The pull request number                                                                                                       |
| `working-directory` | `.`                         | Where the command runs                                                                                                        |
| `openref-bin`       | `node_modules/.bin/openref` | The binary to run                                                                                                             |
| `token`             | `${{ github.token }}`       | The token the comment is posted with                                                                                          |

## Outputs

`breaking-count`, `change-count`, `preview-url`, `comment-url`.

## Moving the bytes

The action builds the preview and names its address. It does not deploy: it cannot reach an
arbitrary host and does not pretend to. Publish `out` with whatever the repository already uses,
and give `preview-base` the root it is published under so the build's links and the address in
the comment are one derived value rather than two that happen to match.
