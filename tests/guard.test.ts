import { describe, expect, it } from "vitest";
import { BlockedUrl, checkUrl, DEFAULT_POLICY, isPublicAddress } from "../src/fetch/guard.js";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
  ])("allows %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    // This machine, the router, the cluster
    ["192.168.1.163", "the k3s node and Traefik"],
    ["192.168.1.1", "the router"],
    ["10.42.0.5", "a pod"],
    ["10.43.0.1", "a Service"],
    // IPv4 ranges
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "this network"],
    ["10.0.0.1", "private"],
    ["100.64.0.1", "carrier NAT"],
    ["100.127.255.255", "carrier NAT"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback"],
    ["169.254.169.254", "cloud metadata"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.0.0.1", "IETF"],
    ["192.0.2.1", "docs"],
    ["192.88.99.1", "6to4 relay"],
    ["192.168.0.1", "private"],
    ["198.18.0.1", "benchmarking"],
    ["198.51.100.1", "docs"],
    ["203.0.113.1", "docs"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
    // IPv6 ranges
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["fc00::1", "unique local"],
    ["fd00::1", "unique local"],
    ["fe80::1", "link local"],
    ["fec0::1", "site local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "docs"],
    // Private addresses dressed up as IPv6
    ["::ffff:127.0.0.1", "mapped loopback"],
    ["::ffff:10.0.0.1", "mapped private"],
    ["::ffff:192.168.1.163", "mapped private"],
    ["::127.0.0.1", "compatible loopback"],
    ["::ffff:0:127.0.0.1", "translated"],
    ["64:ff9b::7f00:1", "NAT64 of loopback"],
    ["64:ff9b:1::1", "local NAT64"],
    ["2002:7f00:1::", "6to4 of loopback"],
    ["2001::1", "Teredo"],
    // Not addresses at all
    ["not-an-ip", "garbage"],
    ["", "empty"],
  ])("blocks %s (%s)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("checkUrl", () => {
  const policy = DEFAULT_POLICY(250);

  it.each([
    "http://example.com/",
    "https://example.com/a?b=c#d",
    "https://example.com:8443/",
    "http://example.com:8080/",
    "http://8.8.8.8/",
    "http://[2606:4700:4700::1111]/",
    "https://sub.domain.example.co.uk/path",
  ])("allows %s", (url) => {
    expect(checkUrl(url, policy).href).toBeTruthy();
  });

  it.each([
    ["ftp://example.com/", /scheme ftp/],
    ["file:///etc/passwd", /scheme file/],
    ["javascript:alert(1)", /scheme javascript/],
    ["gopher://example.com/", /scheme gopher/],
    ["data:text/plain,hi", /scheme data/],
    ["http://user:pass@example.com/", /credentials/],
    ["http://user@example.com/", /credentials/],
    ["http://example.com:22/", /port 22/],
    ["http://example.com:6443/", /port 6443/],
    ["https://example.com:80443/", /valid URL/],
    ["not a url", /valid URL/],
    ["", /valid URL/],
    ["http://localhost/", /internal name/],
    ["http://LOCALHOST:8080/", /internal name/],
    ["http://localhost./", /internal name/],
    ["http://foo.localhost/", /internal name/],
    ["http://intranet/", /internal name/],
    ["http://llmgw/", /internal name/],
    ["http://llmgw.arch.internal/", /internal name/],
    ["http://LLMGW.Arch.Internal./", /internal name/],
    ["http://printer.local/", /internal name/],
    ["http://llmgw.llmgw.svc/", /internal name/],
    ["http://llmgw.llmgw.svc.cluster.local/", /internal name/],
    ["http://kubernetes.default.svc.cluster.local/", /internal name/],
    ["http://metadata.google.internal/", /internal name/],
    ["http://127.0.0.1/", /private address/],
    ["http://192.168.1.163/", /private address/],
    ["http://169.254.169.254/latest/meta-data/", /private address/],
    // Spellings of 127.0.0.1 the URL parser normalizes
    ["http://2130706433/", /private address/],
    ["http://0x7f.0.0.1/", /private address/],
    ["http://0177.0.0.1/", /private address/],
    ["http://127.1/", /private address/],
    ["http://[::1]/", /private address/],
    ["http://[::ffff:127.0.0.1]/", /private address/],
    ["http://[::ffff:7f00:1]/", /private address/],
  ])("blocks %s", (url, reason) => {
    expect(() => checkUrl(url, policy)).toThrow(BlockedUrl);
    expect(() => checkUrl(url, policy)).toThrow(reason);
  });

  it("limits URL length, which also limits how much data one request can carry out", () => {
    const longest = `https://example.com/${"a".repeat(230)}`;
    expect(longest).toHaveLength(250);
    expect(() => checkUrl(longest, policy)).not.toThrow();
    expect(() => checkUrl(`${longest}a`, policy)).toThrow(/longer than 250/);
  });
});
