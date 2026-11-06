# 0011: Read PDFs in capped workers, with a limit on the whole process

- **Status:** accepted, as part of M9, which the user told to go ahead on 2026-11-06. It replaces D11's "later".
- **Date:** 2026-11-06

## Context

v1 refused PDFs, because parsing them needs a heavy library and adds attack surface, and no finish line depended on it. Testing
showed the gap matters: government forms and papers are often PDFs, and a model asked about one could only guess from search
snippets. Anthropic's fetch tool reads them.

The obvious way to add them was dangerous. pdf.js in a worker with the existing limits (5 s, 192 MB of heap) let a **0.2 MB PDF
whose stream inflates to 256 MB peak at 626 MB**, and larger ones past 2 GB. The worker's heap cap doesn't see buffers, and the
pod's limit is 512 MB, so one small file could have restarted mcpgw for everyone.

## Decision

- **`unpdf`,** a build of pdf.js with no native dependencies, imported only inside a worker and only when a PDF arrives. Serving
  HTML never loads it.
- **Text only.** Fonts aren't loaded, pages aren't drawn, and this pdf.js build has no `new Function` path, the route
  CVE-2024-4367 used.
- **The pool watches the whole process's memory,** every 10 ms while a job runs. Over 350 MB, and having grown by more than
  64 MB since that job started, the worker is thrown away and only that request fails. Requiring growth means memory that's slow
  to come back after a bad page doesn't turn away the next one.
- **A PDF cut off at the 5 MB limit is refused with a clear message,** since its index is at the end and it can't be parsed.
- **A PDF with no text says it may be a scan.** Reading scans would need OCR, which isn't planned.
- **PDFs are also recognised by their first bytes** when a server sends a generic type.

## Tested

In the real image, in a container limited to 512 MB like the pod:

| Case | Result | Peak memory |
|---|---|---|
| Bombs inflating to 256 MB, 1 GB and 3 GB, one at a time, at the 400 MB limit first tried | Refused in under a second | 404, 460 and 531 MB |
| Two 3 GB bombs and a real PDF together, three rounds, at 350 MB | Bombs refused, real PDF read | 354 MB |
| Four real PDFs at once, straight after | All read | 274 MB |
| The W-9, the I-140 instructions and the Transformer paper, from the web | Read in 120 to 322 ms | Under 200 MB |

531 MB was too close to the pod's limit, which is why the limit came down to 350 MB.

## Alternatives considered

- **Keep refusing PDFs.** Safe, but it leaves the gap.
- **A child process with its own memory limit.** Stronger isolation, but `ulimit -v` doesn't work with Node's virtual memory
  reservations, and a process per PDF costs far more than a worker.
- **Scanning streams for their inflated size first.** It means writing a second PDF parser to protect the first.
- **Hosted PDF extraction.** It would send documents to a third party, for something a library does in 300 ms.

## Consequences

- **Memory, not just time, now bounds every page,** HTML included.
- **Hidden text in a PDF reaches the model,** as text in a page's body does. Invisible Unicode is removed, but white or tiny text
  can't be told apart from real text here. The URL rule in [ADR 0007](0007-keeping-data-from-leaking-through-web-fetch.md) is still
  the protection.
- **The image grew** by about 3 MB, from 257 to 260 MB.
- **If a real PDF is ever refused for memory,** the limit is `maxRssMb` in `src/fetch/extractor-pool.ts`.
