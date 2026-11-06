# mcpgw

## Stay inside this repo

Only change what belongs to this repo. Don't update anything outside it, such as homestorm, llm-gateway, arch-infra, other
repos, the cluster or this machine's config, unless the user asks for that specific change. Reading and read-only checks
outside the repo are fine.

If work here needs a change outside, say so and wait. For example, deploying a new mcpgw image means bumping its tag in
arch-infra's `apps/mcpgw.yaml`, so ask first.
