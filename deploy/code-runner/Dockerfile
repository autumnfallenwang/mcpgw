# code_run's runner (ADR 0014). Built by CI next to mcpgw's image, tagged <commit>-code-runner in the same package.

# Pyodide and the packages code_run offers, each file checked against a pinned hash.
FROM node:26-alpine AS pyodide
WORKDIR /build
COPY code-runner/fetch-pyodide.mjs ./
RUN node fetch-pyodide.mjs /build/pyodide

# Distroless: no shell and no package manager, only Deno.
FROM denoland/deno:distroless-2.9.8
WORKDIR /app
COPY --from=pyodide /build/pyodide ./pyodide
COPY code-runner/runner.mjs code-runner/pool.mjs code-runner/server.mjs ./
# The root filesystem is read-only in the pod; Deno keeps its own cache here, in an emptyDir.
ENV DENO_DIR=/tmp/deno NO_COLOR=1
USER 1000:1000
EXPOSE 8080
# The server's permissions, not the code's: each run gets only reading /app/pyodide (pool.mjs). It may listen, start
# Deno, read the app, and mark each run first in line for the kernel's out-of-memory killer.
ENTRYPOINT ["/tini", "--", "/bin/deno", "run", "--no-prompt", "--no-config", "--no-remote", "--no-npm", "--no-lock", \
  "--allow-net=0.0.0.0:8080", "--allow-run=/usr/bin/deno", "--allow-read=/app,/usr/bin/deno", "--allow-write=/proc", \
  "--allow-env", "/app/server.mjs"]
CMD []
