import { deflateSync } from "node:zlib";

/** A real, minimal PDF, with its cross-reference table worked out from the bytes. */
export function buildPdf(
  contents: Buffer | string,
  options: { title?: string; flate?: boolean } = {},
) {
  const stream = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "latin1");
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let position = 0;
  const push = (data: Buffer | string) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1");
    parts.push(bytes);
    position += bytes.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = position;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  );
  offsets[4] = position;
  push(
    `4 0 obj\n<< /Length ${stream.length}${options.flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`,
  );
  push(stream);
  push("\nendstream\nendobj\n");
  object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  object(6, `<< /Title (${options.title ?? ""}) >>`);
  const xref = position;
  push("xref\n0 7\n0000000000 65535 f \n");
  for (let i = 1; i <= 6; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

export const pdfWithText = (text: string, title?: string) =>
  buildPdf(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, title ? { title } : {});

/** Small on the wire, huge once inflated: what a hostile page would serve. */
export function pdfBomb(inflatedMb: number): Buffer {
  return buildPdf(deflateSync(Buffer.alloc(inflatedMb * 1024 * 1024, 0x20), { level: 9 }), {
    flate: true,
  });
}
