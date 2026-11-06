# Benchmark

Measures `web_search` and `web_fetch`, and compares them with Claude Code's own search. Any change to the tools can be measured
the same way. See M9 in [the plan](../../docs/plan.md).

## What it runs

**`answers.mjs`: real models answering real questions.** Same model and questions, with only the tools changing:

| Arm | Model | Tools |
|---|---|---|
| `claude-builtin` | Claude Haiku | Claude Code's WebSearch and WebFetch, the baseline |
| `claude-mcpgw` | Claude Haiku | mcpgw |
| `claude-none` | Claude Haiku | None, the control: what the model knows from memory |
| `gpt-mcpgw` | GPT-5.6 Luna | mcpgw, through llmgw like homestorm, at most 4 calls |

**`grade.mjs`: grades them.** Each question has a regex for the clear cases and guidance for the rest. A judge model sees only the
question, the guidance and the answer, in shuffled order, never which setup wrote it. Right scores 100, partial 50, declined 0 and
wrong -50, so a confident wrong answer costs more than "I couldn't confirm".

**`retrieval.mjs`: the tools alone, with no model and no allowance spent.** Are search results on the topic, and does a page give
usable text? 31 searches and 36 pages.

**Questions** (`questions.mjs`): version numbers with answers pulled live from each project's own data, dated facts checked by hand
against outside sources, docs, PDFs, Chinese, a blocked site and everyday questions. `--set hard` adds questions that are too recent
for any model to know, with answers from primary sources such as the ECB, the USGS and ESPN.

## Run it

```sh
cd dev/benchmark
node retrieval.mjs --label mylabel
node answers.mjs --arm claude-mcpgw --label mylabel --run 1
node answers.mjs --arm claude-builtin --label mylabel --run 1
node answers.mjs --arm gpt-mcpgw --label mylabel --run 1
node grade.mjs --label mylabel
```

Run from arch, which reaches mcpgw and llmgw by name, with `claude` logged in. `MCPGW_URL` points it at another mcpgw. Results go
in `results/<label>/`. Dated questions go stale, so check their keys before relying on them in later months.

**Pace it.** All of this comes from one home IP, and bursts draw CAPTCHAs from the engines, which then skews the results: an
unpaced test on 2026-11-05 scored 61% on the topic where a paced one the next day scored 83%, on the same setup.

## Results, 2026-11-06

| Setup | Score | Right | Wrong | Median time |
|---|---|---|---|---|
| Claude, no tools | 29.7 | 9 of 32 | 0 | 3 s |
| Claude, its own search | 93 | 59 of 64 | 1 | 12 s |
| Claude, mcpgw before | 97.7 | 62 of 64 | 0 | 6 s |
| Claude, mcpgw after M9 | 99.2 | 63 of 64 | 0 | 5 s |
| GPT, mcpgw before | 78.1 | 26 of 32 | 3 | 20 s |
| GPT, mcpgw after M9 | 90.6 | 30 of 32 | 2 | 16 s |

Everything with tools scored 100 on the 8 hard questions, and no tools scored 25. Labels in `results/`: `baseline` and `baseline-hard`
for before, `after` and `after-hard` for after, `step1` for the engine mix on the cluster, and `engines` for each mix tried. `after`
ran the new image in local containers. `retrieval.json` under `after` says 25 of 36 pages, but the Transformer PDF was readable and only
its check was too narrow, so it's 26. That check is corrected now. `deployed` is `retrieval.mjs` alone against production, after the
deploy: 98% on the topic and 26 of 36 pages.

## Limits

- **Hand-picked and small:** 40 questions, on one Claude model and one GPT model.
- **The docs questions don't separate the setups.** The model answered all 5 from memory, with no tools.
- **On the topic isn't correct.** `retrieval.mjs` only checks that a result mentions the subject. `answers.mjs` checks correctness.
- **Claude Code's search isn't the API's search tool,** which needs a paid key. Its WebFetch may also summarize pages before the
  model sees them, so fetching isn't a pure like-for-like.
- **One moment in time.** Engine health changes by the hour, so compare runs from the same day where you can.
